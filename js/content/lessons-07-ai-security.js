/* =====================================================================
   lessons-07-ai-security.js
   Modules: pgvector, vector-search, ai-rag, security, roles-permissions,
            row-level-security
   pgvector is an EXTENSION (not core PostgreSQL). Every runnable vector
   example starts with CREATE EXTENSION IF NOT EXISTS vector.
   ===================================================================== */
(function () {

/* Shared toy embedding setup for the company_db documents table.
   5 "meaning" dimensions: [db internals, operations/scale, ai/search, security, commerce/store]
   Real models produce 384-3072 dimensions; 5 keeps the numbers readable. */
var DOCS_EMB = `CREATE EXTENSION IF NOT EXISTS vector;
-- toy 5-d embeddings: [internals, ops/scale, ai/search, security, store]
ALTER TABLE documents ADD COLUMN embedding vector(5);
CREATE INDEX documents_embedding_hnsw ON documents USING hnsw (embedding vector_cosine_ops);
UPDATE documents d SET embedding = v.e::vector
FROM (VALUES
  (1,'[0.9,0.3,0.1,0,0.1]'),  (2,'[0.95,0.2,0,0,0]'),    (3,'[0.9,0.4,0,0.1,0]'),
  (4,'[0.7,0.1,0.2,0,0.2]'),  (5,'[0.3,0.9,0,0.1,0]'),   (6,'[0.2,0.85,0,0.2,0]'),
  (7,'[0.3,0.2,0.95,0,0]'),   (8,'[0.1,0.2,0.95,0.1,0]'),(9,'[0.6,0.7,0,0,0]'),
  (10,'[0.3,0.2,0,0.9,0]'),   (11,'[0.4,0.8,0,0.2,0]'),  (12,'[0.8,0.4,0,0,0]'),
  (13,'[0.7,0.1,0.1,0,0.2]'), (14,'[0.75,0.1,0,0,0.1]'), (15,'[0.8,0.5,0,0,0]'),
  (16,'[0.3,0.9,0.1,0,0]'),   (17,'[0,0,0.1,0,0.95]'),   (18,'[0,0,0,0.1,0.95]'),
  (19,'[0,0.1,0,0,0.9]'),     (20,'[0,0,0,0.1,0.9]'),    (21,'[0.2,0.3,0,0.95,0]'),
  (22,'[0.6,0,0.4,0,0.1]'),   (23,'[0.6,0.6,0,0,0]'),    (24,'[0.6,0,0,0,0.6]')
) AS v(id, e)
WHERE d.id = v.id;
`;

/* Random 16-d vectors for index labs (seeded so results are repeatable). */
var ITEMS_16 = `CREATE EXTENSION IF NOT EXISTS vector;
SELECT setseed(0.42);
CREATE TABLE items AS
SELECT g AS id,
       (ARRAY['books','music','video','toys','pets'])[1 + g % 5] AS category,
       (SELECT array_agg(random()::real) FROM generate_series(1, 16) WHERE g > 0)::vector(16) AS embedding
FROM generate_series(1, 5000) AS g;
ANALYZE items;
`;

PGM.addLessons([
/* ------------------------------------------------------------------ */
{
  id: 'pgvector-embeddings-basics',
  module: 'pgvector',
  title: 'Embeddings & Vectors: Turning Meaning into Geometry',
  level: 7,
  minutes: 22,
  summary: 'What embeddings are, why they have 384-3072 dimensions, and how pgvector (an extension) lets PostgreSQL store and compare them.',
  objectives: [
    'Explain what an embedding is and how an embedding model maps meaning to points in space',
    'Relate common dimension counts (384, 768, 1024, 1536, 3072) to models, storage and speed',
    'Describe why "close in space" means "similar in meaning" and where that breaks down',
    'Store toy vectors in a pgvector column and rank rows by similarity',
    'Distinguish pgvector (an extension) from core PostgreSQL features',
    'Estimate the storage cost of an embedding column for a real table'
  ],
  concept: `<p><strong>An embedding is a list of numbers that describes the meaning of something.</strong> An embedding model (a neural network such as OpenAI <code>text-embedding-3-small</code>, Cohere <code>embed-v3</code>, or the open-source <code>all-MiniLM-L6-v2</code> / <code>bge-base</code>) reads a sentence, an image or a product description and outputs a fixed-length array of floats, for example 1536 numbers. That array is a <strong>vector</strong> (a point in a 1536-dimensional space).</p>
<p><strong>Analogy - a city map of ideas.</strong> Imagine every sentence ever written placed on a gigantic city map. Sentences about "refund policy" live in one neighbourhood, sentences about "returning a damaged laptop" live next door, and "PostgreSQL WAL internals" live across town. The embedding model is the postman who knows the address (coordinates) of every sentence. Semantic search is simply: "give me the 5 houses nearest to this address". A 2-D map has 2 coordinates (x, y); an embedding "map" has hundreds or thousands, so it can separate many more shades of meaning (topic, tone, language, formality...).</p>
<h4>Dimensions you will meet in practice</h4>
<table>
<tr><th>Dimensions</th><th>Typical models</th><th>Bytes per vector (float4)</th><th>Notes</th></tr>
<tr><td>384</td><td>all-MiniLM-L6-v2, bge-small, e5-small</td><td>~1.5 KB</td><td>Fast, cheap, runs on CPU; good for short text</td></tr>
<tr><td>768</td><td>bge-base, e5-base, nomic-embed-text, many BERT-style models</td><td>~3 KB</td><td>Popular open-source sweet spot</td></tr>
<tr><td>1024</td><td>bge-large, Cohere embed-v3, mxbai-embed-large</td><td>~4 KB</td><td>Higher quality, still indexable as <code>vector</code></td></tr>
<tr><td>1536</td><td>OpenAI text-embedding-3-small, ada-002</td><td>~6 KB</td><td>Very common default in RAG tutorials</td></tr>
<tr><td>3072</td><td>OpenAI text-embedding-3-large</td><td>~12 KB</td><td>Too wide for an HNSW index on <code>vector</code> (2000 limit) - use <code>halfvec</code> or shortened dimensions</td></tr>
</table>
<p>Storage formula for pgvector's <code>vector</code> type: <code>4 * dimensions + 8</code> bytes. One million 1536-d embeddings is therefore about 6 GB of raw vector data <em>before</em> the index (HNSW often adds a similar amount again).</p>
<h4>How an embedding model maps meaning to geometry</h4>
<ul>
<li><strong>Training objective:</strong> the model is trained (contrastive learning) so that pairs known to be related ("How do I get a refund?" / "Refunds are issued within 30 days") get vectors pointing in nearly the same direction, while unrelated pairs are pushed apart.</li>
<li><strong>Direction carries meaning, length mostly does not.</strong> That is why <em>cosine distance</em> (angle between vectors) is the default metric for text. Many providers (OpenAI, most sentence-transformers with normalisation) return <strong>unit-length</strong> vectors, so cosine, inner product and L2 all give the same ranking.</li>
<li><strong>No single dimension is a human concept.</strong> In real models dimension 417 does not mean "sports"; meaning is spread across all dimensions. In this course we use tiny 3-5 dimensional <em>toy</em> vectors where each dimension <em>does</em> mean something (e.g. [audio, furniture, display]) so you can reason about the math by hand.</li>
<li><strong>Vectors from different models are incompatible.</strong> A 768-d bge vector and a 768-d e5 vector live in different "cities". Never compare embeddings produced by different models or model versions.</li>
</ul>
<h4>Where PostgreSQL comes in</h4>
<p>Core PostgreSQL has arrays (<code>real[]</code>) but no vector distance operators or ANN (approximate nearest neighbour) indexes. <span class="tag ext">extension</span> <strong>pgvector</strong> adds the <code>vector</code>, <code>halfvec</code>, <code>sparsevec</code> types, distance operators such as <code>&lt;=&gt;</code> (cosine distance), and the HNSW and IVFFlat index access methods. It is open source, ships with most managed services (Amazon RDS/Aurora, Azure Database for PostgreSQL, Google Cloud SQL/AlloyDB, Supabase, Neon) and must be enabled per database with <code>CREATE EXTENSION vector</code>.</p>
<div class="callout info"><strong>pgvector is an extension, not core PostgreSQL.</strong> It is maintained separately (github.com/pgvector/pgvector), has its own version numbers (0.5 added HNSW, 0.7 added halfvec/sparsevec/bit ops, 0.8 added iterative index scans) and must be installed on the server before <code>CREATE EXTENSION</code> works.</div>`,
  why: `<p>Keyword search (<code>LIKE</code>, full-text search with <code>tsvector</code>) matches <em>words</em>. Users ask in <em>meanings</em>: "my headphones broke, can I send them back?" should find the "Return and refund policy" document even though it never says "headphones" or "send back". Embeddings capture that semantic similarity. Storing them inside PostgreSQL (via pgvector) means the vectors live next to the rows they describe: one backup, one transaction, one permission model, and you can JOIN semantic results with customers, orders or tenants in a single SQL statement instead of syncing a separate vector database.</p>`,
  useCase: `<p>An Indian e-commerce company with 2 million products stores a 768-d embedding of each product title+description in <code>products.embedding</code>. When a shopper types "noise cancelling earbuds for gym", the app embeds the query (about 20 ms on a GPU service), then runs <code>ORDER BY embedding &lt;=&gt; $1 LIMIT 20</code> with an HNSW index (about 5-15 ms). The same query filters <code>stock &gt; 0</code> and the shopper's country, which a stand-alone vector store could not do without duplicating inventory data. Storage: 2M x 3 KB = about 6 GB of vectors plus about 6-8 GB of HNSW index - comfortably within a single 64 GB RAM instance.</p>`,
  internals: `<p>The pgvector <code>vector(n)</code> type is a varlena value: a 4-byte length header, a 2-byte dimension count, 2 unused bytes, then <code>n</code> IEEE-754 single-precision floats. Values larger than about 2 KB (roughly 500+ dimensions) are candidates for TOAST compression/out-of-line storage; pgvector sets the column storage to <code>EXTENDED</code> by default for <code>vector</code>, but floats compress poorly, so many teams set <code>ALTER TABLE ... ALTER COLUMN embedding SET STORAGE PLAIN</code> (or <code>MAIN</code>) to avoid TOAST detours on sequential scans. Distance functions are implemented in C with SIMD-friendly loops; computing one 1536-d cosine distance is a few hundred nanoseconds, so a brute-force scan of 1 million rows takes on the order of a second - which is why ANN indexes (HNSW, IVFFlat) exist.</p>`,
  whenNot: `<ul><li><strong>Exact lookups</strong> (order id, SKU, email) - use B-tree indexes; embeddings are fuzzy by design.</li>
<li><strong>Precise keyword or code search</strong> ("error 42P01", product codes) - full-text search or <code>pg_trgm</code> wins; embeddings blur rare tokens. Combine both with hybrid search.</li>
<li><strong>Structured analytics</strong> (revenue per month) - plain SQL aggregates.</li>
<li><strong>Billions of vectors with very high QPS</strong> - a sharded system (Citus + pgvector, or a dedicated vector database) may be required; a single PostgreSQL node is comfortable into the tens of millions.</li></ul>`,
  syntax: `CREATE EXTENSION IF NOT EXISTS vector;        -- pgvector extension, once per database

CREATE TABLE t (
  id        bigint PRIMARY KEY,
  content   text,
  embedding vector(384)                        -- fixed dimension count
);

INSERT INTO t VALUES (1, 'hello', '[0.12, -0.03, ...384 numbers...]');

SELECT id, content
FROM   t
ORDER  BY embedding <=> '[query vector]'       -- cosine distance, smaller = closer
LIMIT  5;`,
  examples: [
    { label: 'Basic', title: 'Toy 3-d embeddings: nearest meaning',
      sql: `CREATE EXTENSION IF NOT EXISTS vector;
-- dimensions: [audio, furniture, display]
CREATE TABLE phrase_embeddings (
  id        int PRIMARY KEY,
  phrase    text NOT NULL,
  embedding vector(3) NOT NULL
);
INSERT INTO phrase_embeddings VALUES
  (1, 'wireless noise-cancelling headphones', '[0.95, 0.00, 0.05]'),
  (2, 'bluetooth party speaker',              '[0.85, 0.05, 0.10]'),
  (3, 'ergonomic office chair',               '[0.00, 0.95, 0.05]'),
  (4, 'standing desk with motor',             '[0.05, 0.90, 0.10]'),
  (5, '27 inch 4K monitor',                   '[0.10, 0.05, 0.95]'),
  (6, 'soundbar for TV',                      '[0.70, 0.00, 0.50]');

-- query: "earbuds for music" embedded by the same toy model
SELECT id, phrase,
       round((embedding <=> '[0.9, 0.0, 0.1]')::numeric, 4) AS cosine_distance
FROM   phrase_embeddings
ORDER  BY embedding <=> '[0.9, 0.0, 0.1]'
LIMIT  3;`,
      explain: `<p><code>CREATE EXTENSION IF NOT EXISTS vector</code> enables pgvector in this database. The column <code>vector(3)</code> only accepts 3-number arrays. The query vector <code>[0.9, 0.0, 0.1]</code> points mostly along the "audio" axis, so the headphones and speaker come first, then the soundbar (audio + display). <code>&lt;=&gt;</code> returns <em>cosine distance</em> = 1 - cosine similarity: 0 means same direction, 1 means perpendicular, 2 means opposite.</p>`,
      output: ` id | phrase                               | cosine_distance
----+--------------------------------------+-----------------
  1 | wireless noise-cancelling headphones |          0.0017
  2 | bluetooth party speaker              |          0.0017
  6 | soundbar for TV                      |          0.1271
(3 rows)`,
      run: true },
    { label: 'Intermediate', title: 'Inspect vectors: dimensions, norms, normalisation',
      sql: `CREATE EXTENSION IF NOT EXISTS vector;
SELECT vector_dims('[3, 4, 0]'::vector)                AS dims,
       vector_norm('[3, 4, 0]'::vector)                AS length,
       l2_normalize('[3, 4, 0]'::vector)               AS unit_vector,
       vector_norm(l2_normalize('[3, 4, 0]'::vector))  AS unit_length,
       1 - ('[3, 4, 0]'::vector <=> '[6, 8, 0]')       AS cosine_similarity,
       '[3, 4, 0]'::vector <-> '[6, 8, 0]'             AS l2_distance;`,
      explain: `<p><code>vector_dims</code> counts dimensions; <code>vector_norm</code> is the Euclidean length sqrt(3^2+4^2)=5. <code>l2_normalize</code> divides every component by the length, producing a unit vector [0.6, 0.8, 0]. <code>[3,4,0]</code> and <code>[6,8,0]</code> point in exactly the same direction, so cosine similarity is 1 (distance 0) even though their L2 (straight-line) distance is 5. This is why text search uses cosine: a longer document should not look "different" just because its vector is longer. (The unit length prints as 1.00000002 because components are stored as 32-bit floats.)</p>`,
      output: ` dims | length | unit_vector | unit_length | cosine_similarity | l2_distance
------+--------+-------------+-------------+-------------------+-------------
    3 |      5 | [0.6,0.8,0] | 1.000000023841858 |                 1 |           5
(1 row)`,
      run: true },
    { label: 'Advanced', title: 'Attach embeddings to company_db products',
      sql: `CREATE EXTENSION IF NOT EXISTS vector;
-- toy 4-d model: [audio, video/display, furniture, connectivity]
ALTER TABLE products ADD COLUMN embedding vector(4);
UPDATE products SET embedding = (CASE category
    WHEN 'audio'       THEN ARRAY[0.90, 0.10, 0.00, 0.20]
    WHEN 'video'       THEN ARRAY[0.20, 0.90, 0.00, 0.10]
    WHEN 'electronics' THEN ARRAY[0.30, 0.50, 0.00, 0.40]
    WHEN 'furniture'   THEN ARRAY[0.00, 0.00, 0.95, 0.00]
    WHEN 'networking'  THEN ARRAY[0.00, 0.10, 0.00, 0.95]
    WHEN 'storage'     THEN ARRAY[0.00, 0.20, 0.00, 0.70]
    ELSE                    ARRAY[0.40, 0.30, 0.10, 0.30]
  END)::vector(4);

-- "portable music" query, but only products in stock
SELECT category,
       count(*)                                                   AS products,
       round(min(embedding <=> '[0.85,0.05,0,0.3]')::numeric, 3)  AS best_distance
FROM   products
WHERE  stock > 0
GROUP  BY category
ORDER  BY best_distance
LIMIT  4;`,
      explain: `<p>We add a <code>vector(4)</code> column to the existing <code>products</code> table and fill it with a toy embedding per category (a real system would embed each product's title + description individually). The query mixes vector distance with normal SQL: a <code>WHERE stock &gt; 0</code> filter and a <code>GROUP BY</code>. That combination - semantic ranking plus relational filters in one statement - is the core reason to keep vectors in PostgreSQL.</p>`,
      output: ` category    | products | best_distance
-------------+----------+---------------
 audio       |       10 |         0.009
 accessories |       20 |         0.167
 electronics |       20 |         0.373
 networking  |       10 |         0.664
(4 rows)`,
      run: true }
  ],
  compare: {
    bad: { sql: `-- Storing embeddings as plain float arrays: no distance operators, no ANN index
CREATE TABLE emb_bad (id int PRIMARY KEY, embedding real[]);
INSERT INTO emb_bad VALUES (1, '{0.9,0.0,0.1}'), (2, '{0.0,0.95,0.05}');
-- similarity must be hand-written and can never use an index
SELECT id,
       (SELECT sum(a*b) FROM unnest(embedding, '{0.9,0,0.1}'::real[]) AS u(a,b)) AS dot
FROM emb_bad ORDER BY dot DESC;`, why: 'Core arrays work, but every query computes distances row by row in slow SQL, nothing enforces the dimension count, and no index type can accelerate ORDER BY similarity.', run: true },
    good: { sql: `CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE emb_good (id int PRIMARY KEY, embedding vector(3));
INSERT INTO emb_good VALUES (1, '[0.9,0.0,0.1]'), (2, '[0.0,0.95,0.05]');
CREATE INDEX ON emb_good USING hnsw (embedding vector_cosine_ops);
SELECT id FROM emb_good ORDER BY embedding <=> '[0.9,0,0.1]' LIMIT 1;`, why: 'The vector type enforces 3 dimensions, distance math runs in optimised C, and an HNSW index can serve ORDER BY ... LIMIT k without scanning every row.', run: true }
  },
  mistakes: [
    'Mixing embeddings from two different models (or two versions of the same model) in one column - distances between them are meaningless.',
    'Choosing the dimension count by "bigger is better" - 3072-d vectors cost 8x the storage and RAM of 384-d ones and exceed the 2000-dimension HNSW limit for <code>vector</code>.',
    'Embedding the query with a different model, prefix or normalisation than the documents (e5 models, for example, expect <code>query:</code> / <code>passage:</code> prefixes).',
    'Assuming each dimension has a human meaning in real models - only toy examples work that way.',
    'Forgetting that pgvector is an extension: <code>type "vector" does not exist</code> means <code>CREATE EXTENSION vector</code> was never run in <em>this</em> database.'
  ],
  best: [
    'Record the model name and version next to every embedding (or in the table name) so re-embedding is traceable.',
    'Prefer normalised (unit-length) embeddings and cosine distance for text unless the model card says otherwise.',
    'Start with a 384-768 d model; move up only if retrieval evaluation shows a real quality gain.',
    'Keep the source text (or chunk) in the same row so results can be shown and re-embedded later.',
    'Budget memory: rows x (4 x dims + 8) bytes for vectors, and plan for the index to be of a similar size.'
  ],
  performance: `<p>Cost scales linearly with dimensions: a 1536-d distance is 4x the work of a 384-d one, and the index is 4x larger, so fewer index pages fit in <code>shared_buffers</code>. Without an index, <code>ORDER BY embedding &lt;=&gt; q LIMIT k</code> is an exact scan: fine for a few thousand rows, roughly 0.5-2 s per million 1536-d rows on one core (parallel sequential scan helps). With HNSW the same query typically takes single-digit milliseconds at 95%+ recall. Reducing dimensions (OpenAI v3 models support a <code>dimensions</code> parameter) or using <code>halfvec</code> halves storage with negligible quality loss.</p>`,
  security: `<p>Embeddings are derived data but can leak information: research has shown that text can be partially reconstructed from embeddings. Treat the embedding column with the same access controls as the source text (GRANTs, Row Level Security). Never send confidential text to a third-party embedding API without a data-processing agreement; self-hosted models avoid that exposure.</p>`,
  scenario: { title: 'Your support search returns nothing for "send my broken earbuds back"', steps: [
    '1. Confirm the keyword search: the refund document never contains "earbuds" or "send back", so tsvector search misses it.',
    '2. Install pgvector (CREATE EXTENSION vector) and add an embedding vector(384) column to the documents/chunks table.',
    '3. Embed every document with one chosen model; store model name and version.',
    '4. At query time embed the user question with the same model and ORDER BY embedding <=> query LIMIT 5.',
    '5. Measure: build 50 real questions with expected documents and check how many appear in the top 5 (recall@5).',
    '6. Add an HNSW index once the table grows beyond a few tens of thousands of rows, and consider hybrid search for exact keywords.'
  ] },
  widgets: ['diagram:vector-db'],
  interview: [
    { q: 'What is an embedding, in one minute?', a: 'An embedding is a fixed-length numeric vector produced by a trained model so that semantically similar inputs land close together in vector space. Similarity is then measured geometrically, usually as cosine distance. It lets you search by meaning rather than by exact words.' },
    { q: 'Why is cosine distance the default for text embeddings?', a: 'Cosine compares direction and ignores vector length, and with text models the direction encodes meaning while length mostly reflects things like token count. If vectors are normalised to unit length, cosine, inner product and L2 produce identical rankings, so inner product can be used as a faster equivalent.' },
    { q: 'Is pgvector part of PostgreSQL?', a: 'No. pgvector is an open-source extension maintained outside the PostgreSQL project. It must be installed on the server and enabled per database with CREATE EXTENSION vector; it adds the vector, halfvec and sparsevec types, distance operators and the HNSW and IVFFlat index methods.' },
    { q: 'How much storage do 10 million 768-d embeddings need?', a: 'A pgvector vector uses 4 bytes per dimension plus 8 bytes of header, so 768-d is about 3 KB; 10 million rows is roughly 30 GB of vector data, plus an HNSW index of a similar order. Using halfvec halves the vector portion.' }
  ],
  exercises: [
    { task: 'Create a table of 4 toy "animal" phrases with 2-d embeddings [land, water] and return the phrase closest to the query [0.1, 0.9] by cosine distance.',
      solution: `CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE animals (phrase text, embedding vector(2));
INSERT INTO animals VALUES
  ('lion', '[0.95,0.05]'), ('dolphin', '[0.05,0.95]'),
  ('frog', '[0.5,0.5]'),   ('shark', '[0.0,1.0]');
SELECT phrase, embedding <=> '[0.1,0.9]' AS dist
FROM animals ORDER BY dist LIMIT 1;`, run: true },
    { task: 'Compute the storage in MB for 1 million vectors of 384, 768 and 1536 dimensions using the formula 4*dims+8 bytes.',
      solution: `SELECT dims, round((4 * dims + 8) * 1000000::bigint / 1024.0 / 1024, 0) AS mb_per_million
FROM (VALUES (384), (768), (1536), (3072)) AS v(dims);`, run: true }
  ],
  challenge: { task: 'Using the toy 3-d phrase table from the Basic example, return each phrase with its single nearest OTHER phrase (by cosine distance) using a LATERAL join.',
    hint: 'CROSS JOIN LATERAL (SELECT ... WHERE p2.id <> p1.id ORDER BY p2.embedding <=> p1.embedding LIMIT 1).',
    solution: `CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE phrase_embeddings (id int PRIMARY KEY, phrase text, embedding vector(3));
INSERT INTO phrase_embeddings VALUES
  (1, 'wireless noise-cancelling headphones', '[0.95, 0.00, 0.05]'),
  (2, 'bluetooth party speaker',              '[0.85, 0.05, 0.10]'),
  (3, 'ergonomic office chair',               '[0.00, 0.95, 0.05]'),
  (4, 'standing desk with motor',             '[0.05, 0.90, 0.10]'),
  (5, '27 inch 4K monitor',                   '[0.10, 0.05, 0.95]'),
  (6, 'soundbar for TV',                      '[0.70, 0.00, 0.50]');
SELECT p1.phrase, nn.phrase AS nearest, round(nn.dist::numeric, 4) AS dist
FROM phrase_embeddings p1
CROSS JOIN LATERAL (
  SELECT p2.phrase, p2.embedding <=> p1.embedding AS dist
  FROM phrase_embeddings p2
  WHERE p2.id <> p1.id
  ORDER BY p2.embedding <=> p1.embedding
  LIMIT 1
) nn
ORDER BY p1.id;`, run: true },
  related: ['pgvector-install-types', 'pgvector-distance-operators', 'vector-search', 'ai-rag', 'full-text-search'],
  quiz: [
    { type: 'mcq', q: 'What does an embedding model output for one sentence?', options: ['A tsvector of lexemes', 'A fixed-length array of floating-point numbers', 'A B-tree key', 'A variable-length list of keywords'], answer: 1, explain: 'An embedding is a dense, fixed-length float vector (e.g. 384 or 1536 numbers).' },
    { type: 'tf', q: 'pgvector is built into PostgreSQL 17 and later, so CREATE EXTENSION is not needed.', answer: false, explain: 'pgvector is a separate extension; it must be installed and enabled with CREATE EXTENSION vector in each database.' },
    { type: 'predict', q: 'What does this return?', code: `SELECT '[1,0]'::vector <=> '[5,0]'::vector;`, options: ['0', '4', '1', '16'], answer: 0, explain: 'Both vectors point in the same direction, so cosine distance is 0 even though their lengths differ.' },
    { type: 'design', q: 'You use OpenAI text-embedding-3-large (3072-d) and want an HNSW index. Best option?', options: ['Index the vector(3072) column directly', 'Store/index as halfvec(3072) or request fewer dimensions from the model', 'Use a B-tree index', 'Split the vector into two columns'], answer: 1, explain: 'HNSW on vector supports up to 2000 dimensions; halfvec supports up to 4000, and v3 models can return shortened embeddings.' },
    { type: 'mcq', q: 'Two embeddings were created by different models, both 768-d. Comparing them with cosine distance is...', options: ['Fine, dimensions match', 'Meaningless - each model has its own vector space', 'Fine if both are normalised', 'Only valid with L2'], answer: 1, explain: 'Matching dimension counts do not imply a shared space; only same-model vectors are comparable.' }
  ]
},
/* ------------------------------------------------------------------ */
{
  id: 'pgvector-install-types',
  module: 'pgvector',
  title: 'Installing pgvector: vector, halfvec, sparsevec and bit Types',
  level: 7,
  minutes: 20,
  summary: 'Install and enable the pgvector extension, choose between vector, halfvec, sparsevec and bit, and know the dimension limits for storage and indexing.',
  objectives: [
    'Install pgvector at the OS/managed-service level and enable it with CREATE EXTENSION',
    'Declare vector(n) columns and insert vectors from text literals and arrays',
    'Choose between vector, halfvec, sparsevec and bit for storage and indexing',
    'Know the limits: 16,000 dims storage, 2,000 (vector) / 4,000 (halfvec) / 64,000 (bit) for HNSW',
    'Upgrade the extension with ALTER EXTENSION vector UPDATE',
    'Cast between types for expression indexes'
  ],
  concept: `<p><span class="tag ext">extension</span> pgvector is installed in two steps. <strong>Step 1 - put the binaries on the server</strong> (OS package, source build or managed-service allow-list). <strong>Step 2 - enable it inside each database</strong> with <code>CREATE EXTENSION vector;</code> (note: the extension name is <code>vector</code>, not <code>pgvector</code>). Step 2 creates the types, operators, functions and index access methods in the current schema (usually <code>public</code>).</p>
<p><strong>Analogy:</strong> installing the package is like buying a new appliance and storing it in the building; <code>CREATE EXTENSION</code> is plugging it in in a particular flat (database). Each database that wants vectors must plug it in.</p>
<h4>Install options</h4>
<ul>
<li>Debian/Ubuntu (PGDG repo): <code>sudo apt install postgresql-17-pgvector</code></li>
<li>RHEL/Rocky: <code>sudo dnf install pgvector_17</code></li>
<li>macOS Homebrew: <code>brew install pgvector</code></li>
<li>Docker: image <code>pgvector/pgvector:pg17</code></li>
<li>Source: <code>git clone ... &amp;&amp; make &amp;&amp; make install</code> (needs PostgreSQL server headers)</li>
<li>Managed: RDS/Aurora, Azure Flexible Server (add <code>VECTOR</code> to <code>azure.extensions</code>), Cloud SQL, AlloyDB, Supabase, Neon - just run <code>CREATE EXTENSION vector</code>.</li>
</ul>
<h4>The four types</h4>
<table>
<tr><th>Type</th><th>Element</th><th>Bytes</th><th>Max dims stored</th><th>Max dims in HNSW / IVFFlat</th><th>Use for</th></tr>
<tr><td><code>vector(n)</code></td><td>float4 (32-bit)</td><td>4n + 8</td><td>16,000</td><td>2,000</td><td>Default dense embeddings</td></tr>
<tr><td><code>halfvec(n)</code></td><td>float2 (16-bit)</td><td>2n + 8</td><td>16,000</td><td>4,000</td><td>Halve storage/RAM; index 3072-d models</td></tr>
<tr><td><code>sparsevec(n)</code></td><td>index:value pairs</td><td>8 * nnz + 16</td><td>1,000,000,000 dims; 16,000 non-zero</td><td>1,000 non-zero (HNSW only)</td><td>SPLADE / BM25-style sparse vectors</td></tr>
<tr><td><code>bit(n)</code></td><td>1 bit (core type)</td><td>n/8 + 8</td><td>core limit</td><td>64,000</td><td>Binary quantisation, Hamming/Jaccard</td></tr>
</table>
<p><code>bit</code> is a core PostgreSQL type; pgvector adds the Hamming (<code>&lt;~&gt;</code>) and Jaccard (<code>&lt;%&gt;</code>) operators and index operator classes for it.</p>
<h4>Literal formats</h4>
<ul>
<li><code>vector</code>/<code>halfvec</code>: <code>'[1, 2.5, -3]'</code> (square brackets, JSON-like).</li>
<li><code>sparsevec</code>: <code>'{1:0.5,7:1.2}/10'</code> - 1-based index:value pairs, then <code>/</code>total dimensions.</li>
<li>Arrays cast: <code>ARRAY[1,2,3]::vector</code>, <code>'{1,2,3}'::real[]::vector</code>, and back with <code>embedding::real[]</code>.</li>
</ul>`,
  why: `<p>Embedding sizes and budgets vary wildly. A startup with 100k 384-d vectors can use plain <code>vector</code> everywhere; a company indexing 50M 3072-d vectors needs <code>halfvec</code> to fit the index in RAM and to get under the 2000-dim HNSW limit; a search team using learned sparse models (SPLADE) needs <code>sparsevec</code>; and binary quantisation (<code>bit</code>) can shrink an index 32x for a fast first-pass search. pgvector offers all of them inside one extension.</p>`,
  useCase: `<p>A legal-tech firm embeds 40 million contract clauses with a 3072-d model. As <code>vector(3072)</code> that is 40M x 12 KB = 480 GB, and HNSW cannot index it. They store <code>halfvec(3072)</code> (240 GB) and build an HNSW index on it; quality loss measured on their evaluation set is under 0.2% recall. For a first-pass "rough" search they also index <code>binary_quantize(embedding)::bit(3072)</code> (384 bytes per row) and re-rank the top 200 candidates with full-precision cosine distance.</p>`,
  internals: `<p><code>CREATE EXTENSION vector</code> runs the extension's SQL script: it registers C functions from <code>vector.so</code>, the types with input/output/binary-send functions, operators, operator classes (<code>vector_l2_ops</code>, <code>vector_ip_ops</code>, <code>vector_cosine_ops</code>, <code>vector_l1_ops</code>, <code>halfvec_*_ops</code>, <code>sparsevec_*_ops</code>, <code>bit_hamming_ops</code>, <code>bit_jaccard_ops</code>) and the <code>hnsw</code> and <code>ivfflat</code> index access methods (visible in <code>pg_am</code>). The row in <code>pg_extension</code> records the installed version; <code>ALTER EXTENSION vector UPDATE</code> runs upgrade scripts after new binaries are installed. Dimension limits for indexes come from the 8 KB page size: an HNSW element (vector + neighbour lists) must fit on one page, which is why 2000 x 4 bytes is the ceiling for <code>vector</code> and 4000 x 2 bytes for <code>halfvec</code>.</p>`,
  whenNot: `<ul><li>Do not create the extension in every schema "just in case" - one per database, ideally in a dedicated <code>extensions</code> schema on shared clusters.</li>
<li>Do not use <code>halfvec</code> for values outside about +/-65,504 or needing more than ~3 significant digits (rare for embeddings).</li>
<li>Do not use <code>sparsevec</code> for dense model output - it costs 8 bytes per non-zero element versus 4 for <code>vector</code>.</li>
<li>Do not rely on <code>bit</code> alone for final ranking - binary codes lose most information; re-rank with full vectors.</li></ul>`,
  syntax: `-- server (outside SQL):  apt install postgresql-17-pgvector
CREATE EXTENSION IF NOT EXISTS vector;              -- optionally: SCHEMA extensions
ALTER EXTENSION vector UPDATE;                      -- after upgrading binaries

column_name vector(n)      -- float4, n <= 16000 (index <= 2000)
column_name halfvec(n)     -- float2, n <= 16000 (index <= 4000)
column_name sparsevec(n)   -- '{idx:val,...}/n'
column_name bit(n)         -- core type, pgvector adds <~> and <%>

SELECT extversion FROM pg_extension WHERE extname = 'vector';`,
  examples: [
    { label: 'Basic', title: 'Enable the extension and check its version',
      sql: `CREATE EXTENSION IF NOT EXISTS vector;
SELECT extname, extversion, extnamespace::regnamespace AS schema
FROM   pg_extension
WHERE  extname = 'vector';

SELECT amname FROM pg_am WHERE amname IN ('hnsw', 'ivfflat') ORDER BY amname;`,
      explain: `<p><code>pg_extension</code> lists installed extensions and their version. pgvector 0.8.x is current at the time of writing; features such as iterative index scans need 0.8.0+. <code>pg_am</code> lists index access methods - pgvector adds <code>hnsw</code> and <code>ivfflat</code> next to core methods like <code>btree</code>, <code>gin</code> and <code>gist</code>.</p>`,
      output: ` extname | extversion | schema
---------+------------+--------
 vector  | 0.8.1      | public
(1 row)

 amname
---------
 hnsw
 ivfflat
(2 rows)`,
      run: true },
    { label: 'Intermediate', title: 'vector, halfvec, sparsevec and bit side by side',
      sql: `CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE type_demo (
  id     int PRIMARY KEY,
  dense  vector(4),
  half   halfvec(4),
  sparse sparsevec(8),
  bits   bit(4)
);
INSERT INTO type_demo VALUES
  (1, '[0.12,-0.5,0.33,0.9]', '[0.12,-0.5,0.33,0.9]', '{1:0.7,6:1.5}/8', B'1011'),
  (2, ARRAY[1,2,3,4]::vector, ARRAY[1,2,3,4]::halfvec, '{2:3}/8', B'0011');

SELECT id, dense, half, sparse, bits,
       pg_column_size(dense)  AS dense_bytes,
       pg_column_size(half)   AS half_bytes,
       pg_column_size(sparse) AS sparse_bytes
FROM   type_demo ORDER BY id;`,
      explain: `<p>In memory the same 4 numbers take 24 bytes as <code>vector</code> (8-byte header + 4x4) and 16 bytes as <code>halfvec</code> (8 + 4x2). Stored in a table row, small values get a 1-byte short varlena header instead of 4 bytes, which is why <code>pg_column_size</code> reports 21 and 13 here. Notice that halfvec stores 0.12 as an approximation - 16-bit floats have ~3 significant digits, plenty for embeddings. <code>sparsevec</code> stores only the non-zero entries (index:value) plus the total dimension (8). Arrays cast directly into vector types, which is handy when an application sends <code>float[]</code>.</p>`,
      output: ` id | dense                | half                         | sparse          | bits | dense_bytes | half_bytes | sparse_bytes
----+----------------------+------------------------------+-----------------+------+-------------+------------+--------------
  1 | [0.12,-0.5,0.33,0.9] | [0.11999512,-0.5,0.33007812,0.89990234] | {1:0.7,6:1.5}/8 | 1011 |          21 |         13 |           29
  2 | [1,2,3,4]            | [1,2,3,4]                               | {2:3}/8         | 0011 |          21 |         13 |           21
(2 rows)`,
      run: true },
    { label: 'Advanced', title: 'Dimension limits and the halfvec expression-index workaround',
      sql: `CREATE EXTENSION IF NOT EXISTS vector;
-- a 3072-d model (e.g. text-embedding-3-large) stored at full precision
CREATE TABLE big_emb (id bigint PRIMARY KEY, embedding vector(3072));

-- CREATE INDEX ON big_emb USING hnsw (embedding vector_cosine_ops);
--   ERROR: column cannot have more than 2000 dimensions for hnsw index

-- workaround 1: index a halfvec expression (limit 4000 dims)
CREATE INDEX big_emb_half_idx ON big_emb
  USING hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops);

-- workaround 2: binary-quantised expression (limit 64000 dims)
CREATE INDEX big_emb_bq_idx ON big_emb
  USING hnsw ((binary_quantize(embedding)::bit(3072)) bit_hamming_ops);

SELECT indexrelid::regclass AS index_name, pg_get_indexdef(indexrelid) AS definition
FROM   pg_index WHERE indrelid = 'big_emb'::regclass ORDER BY 1;`,
      explain: `<p>HNSW stores each vector inside an index page, so the 8 KB page size caps <code>vector</code> at 2000 dimensions. Casting to <code>halfvec(3072)</code> in an <strong>expression index</strong> keeps full-precision data in the table while the index stores 16-bit values. Queries must use the <em>same expression</em> to use the index: <code>ORDER BY embedding::halfvec(3072) &lt;=&gt; $1::halfvec(3072)</code>. The binary-quantised index is 1 bit per dimension and is used for a fast candidate search followed by re-ranking.</p>`,
      output: ` index_name       | definition
------------------+------------------------------------------------------------------------------------------------
 big_emb_bq_idx   | CREATE INDEX big_emb_bq_idx ON public.big_emb USING hnsw (((binary_quantize(embedding))::bit(3072)) bit_hamming_ops)
 big_emb_half_idx | CREATE INDEX big_emb_half_idx ON public.big_emb USING hnsw (((embedding)::halfvec(3072)) halfvec_cosine_ops)
 big_emb_pkey     | CREATE UNIQUE INDEX big_emb_pkey ON public.big_emb USING btree (id)
(3 rows)`,
      run: true }
  ],
  compare: {
    bad: { sql: `CREATE EXTENSION IF NOT EXISTS vector;
-- unconstrained dimension: any length accepted, cannot be indexed
CREATE TABLE emb_any (id int PRIMARY KEY, embedding vector);
INSERT INTO emb_any VALUES (1, '[1,2,3]'), (2, '[1,2,3,4,5]');
SELECT id, vector_dims(embedding) FROM emb_any;`, why: 'A column declared as plain vector accepts mixed dimensions (a bug waiting to happen when a model changes) and HNSW/IVFFlat refuse to index a column without a fixed dimension.', run: true },
    good: { sql: `CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE emb_fixed (id int PRIMARY KEY, embedding vector(3) NOT NULL);
INSERT INTO emb_fixed VALUES (1, '[1,2,3]');
-- INSERT INTO emb_fixed VALUES (2, '[1,2,3,4,5]');  -- ERROR: expected 3 dimensions, not 5
CREATE INDEX ON emb_fixed USING hnsw (embedding vector_l2_ops);
SELECT id, vector_dims(embedding) FROM emb_fixed;`, why: 'vector(3) rejects wrong-sized vectors at insert time and can be indexed.', run: true }
  },
  mistakes: [
    'Running <code>CREATE EXTENSION pgvector</code> - the extension is named <code>vector</code>.',
    'Installing the package for the wrong PostgreSQL major version (e.g. postgresql-16-pgvector on a 17 server) - you get "could not open extension control file".',
    'Declaring <code>vector</code> without a dimension and later discovering it cannot be indexed.',
    'Indexing <code>embedding::halfvec(3072)</code> but querying <code>embedding &lt;=&gt; $1</code> - the expression differs, so the index is ignored.',
    'Forgetting <code>ALTER EXTENSION vector UPDATE</code> after upgrading binaries - new functions and operators stay invisible.'
  ],
  best: [
    'Always declare the dimension: <code>vector(768)</code>, <code>halfvec(3072)</code>.',
    'Install extensions into a dedicated schema on shared clusters (<code>CREATE EXTENSION vector SCHEMA extensions</code>) and add it to <code>search_path</code>.',
    'Use <code>halfvec</code> for large-scale or &gt;2000-d embeddings; measure recall before and after.',
    'Pin and document the pgvector version per environment; test upgrades in staging and run <code>ALTER EXTENSION vector UPDATE</code>.',
    'Send vectors from applications as parameters (text <code>[...]</code> or binary via pgvector client libraries for Python, Node, Java, Go, .NET).'
  ],
  performance: `<p><code>halfvec</code> halves table and index size, so twice as many vectors fit in <code>shared_buffers</code>/OS cache and HNSW builds faster; distance computation cost is similar (pgvector converts to float internally, with F16C SIMD on x86). <code>bit</code> codes are 32x smaller than <code>vector</code> and Hamming distance uses CPU popcount, making first-pass candidate searches very fast. For text-embedding columns over ~500 dimensions, consider <code>ALTER TABLE ... ALTER COLUMN embedding SET STORAGE PLAIN</code> so vectors stay inline rather than being TOASTed - but note a row must then still fit in a page (vector(2000) = 8 KB is the practical limit).</p>`,
  security: `<p>pgvector's control file does not mark it <em>trusted</em>, so <code>CREATE EXTENSION vector</code> requires a superuser on self-managed servers (managed services delegate it to their admin role, e.g. <code>rds_superuser</code> or <code>azure_pg_admin</code>, and enforce an allow-list). Create it once as an admin during provisioning/migrations; application roles never need that power. Installing extensions into <code>public</code> on shared databases lets anyone with CREATE on that schema shadow functions; prefer a dedicated schema owned by an admin role.</p>`,
  scenario: { title: 'Migrating from text-embedding-ada-002 (1536-d) to text-embedding-3-large (3072-d)', steps: [
    '1. Add a new column embedding_v2 halfvec(3072) (vector(3072) cannot be HNSW-indexed).',
    '2. Backfill in batches of a few thousand rows, committing each batch, while the old column keeps serving traffic.',
    '3. Build CREATE INDEX CONCURRENTLY ... USING hnsw (embedding_v2 halfvec_cosine_ops) with generous maintenance_work_mem.',
    '4. Run the evaluation set against both columns; compare recall@10 and latency.',
    '5. Switch the application query to the new column (same expression as the index), then drop the old column and index.'
  ] },
  widgets: ['diagram:vector-db'],
  interview: [
    { q: 'What are the two steps to start using pgvector?', a: 'First install the extension binaries on the database server for the matching PostgreSQL major version (OS package, Docker image, source build, or managed-service allow-list). Then run CREATE EXTENSION vector in each database that needs it; that registers the types, operators and the hnsw and ivfflat access methods.' },
    { q: 'Why does HNSW refuse to index vector(3072)?', a: 'Index tuples must fit on an 8 KB page, so pgvector limits HNSW and IVFFlat on vector to 2000 dimensions. You can index a halfvec cast (up to 4000 dims), a binary-quantised bit expression (up to 64000) or reduce the model output dimension.' },
    { q: 'When would you use sparsevec?', a: 'For sparse representations where most dimensions are zero, such as SPLADE learned sparse embeddings or bag-of-words weights over a large vocabulary. sparsevec stores only index:value pairs, supports up to 16000 non-zero elements and can be HNSW-indexed with up to 1000 non-zero elements.' },
    { q: 'What does halfvec cost you in quality?', a: 'halfvec stores 16-bit floats with roughly three significant decimal digits. Embedding components are small numbers whose ranking is robust to that rounding, so recall loss is usually negligible, while storage and index size halve. Always confirm with an evaluation set.' }
  ],
  exercises: [
    { task: 'Create a table with a halfvec(3) column, insert two vectors from ARRAY literals, and show them cast back to vector and to real[].',
      solution: `CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE h (id int, e halfvec(3));
INSERT INTO h VALUES (1, ARRAY[0.1,0.2,0.3]::halfvec), (2, ARRAY[1,0,0]::halfvec);
SELECT id, e, e::vector AS as_vector, e::vector::real[] AS as_array FROM h;`, run: true },
    { task: 'Store the sparse vector with value 2.5 at position 3 and 1.0 at position 9 in a 10-dimensional sparsevec and return its dense equivalent.',
      solution: `CREATE EXTENSION IF NOT EXISTS vector;
SELECT '{3:2.5,9:1}/10'::sparsevec AS sparse,
       '{3:2.5,9:1}/10'::sparsevec::vector AS dense;`, run: true },
    { task: 'List every operator class pgvector provides for the hnsw access method.',
      solution: `CREATE EXTENSION IF NOT EXISTS vector;
SELECT opc.opcname
FROM pg_opclass opc JOIN pg_am am ON am.oid = opc.opcmethod
WHERE am.amname = 'hnsw'
ORDER BY 1;`, run: true }
  ],
  challenge: { task: 'Create a table with an embedding vector(2500) column. Build an HNSW cosine index that is allowed despite the 2000-dimension limit, and show (with EXPLAIN) a query that uses it.',
    hint: 'Expression index on embedding::halfvec(2500) with halfvec_cosine_ops, and the query must ORDER BY the identical expression.',
    solution: `CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE wide (id int PRIMARY KEY, embedding vector(2500));
INSERT INTO wide
SELECT g, (SELECT array_agg(random()::real) FROM generate_series(1,2500) WHERE g > 0)::vector(2500)
FROM generate_series(1, 50) g;
CREATE INDEX wide_half_idx ON wide USING hnsw ((embedding::halfvec(2500)) halfvec_cosine_ops);
SET enable_seqscan = off;
EXPLAIN (COSTS OFF)
SELECT id FROM wide
ORDER BY embedding::halfvec(2500) <=> (SELECT embedding::halfvec(2500) FROM wide WHERE id = 1)
LIMIT 5;`, run: true },
  related: ['pgvector-embeddings-basics', 'pgvector-distance-operators', 'pgvector-hnsw-index', 'extensions'],
  quiz: [
    { type: 'mcq', q: 'Which statement enables pgvector in the current database?', options: ['CREATE EXTENSION pgvector;', 'CREATE EXTENSION vector;', 'LOAD pgvector;', 'ALTER SYSTEM SET shared_preload_libraries = vector;'], answer: 1, explain: 'The extension name is vector. It does not need shared_preload_libraries.' },
    { type: 'mcq', q: 'Max dimensions for an HNSW index on halfvec?', options: ['2,000', '4,000', '16,000', '64,000'], answer: 1, explain: 'vector: 2000, halfvec: 4000, bit: 64000, sparsevec: 1000 non-zero elements.' },
    { type: 'predict', q: 'What is pg_column_size of this value?', code: `SELECT pg_column_size('[1,2,3,4]'::vector);`, options: ['16', '24', '32', '8'], answer: 1, explain: '8 bytes of header plus 4 x 4-byte floats = 24.' },
    { type: 'bug', q: 'The index exists but the query does a sequential scan. Why?', code: `CREATE INDEX ON docs USING hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops);
SELECT id FROM docs ORDER BY embedding <=> $1 LIMIT 10;`, options: ['halfvec is not indexable', 'The ORDER BY expression must be embedding::halfvec(3072) <=> $1::halfvec(3072)', 'LIMIT is missing', 'HNSW needs ANALYZE first'], answer: 1, explain: 'Expression indexes are used only when the query uses the identical expression.' },
    { type: 'tf', q: 'bit is a type added by pgvector.', answer: false, explain: 'bit is a core PostgreSQL type; pgvector adds Hamming and Jaccard operators and index support for it.' }
  ]
},
/* ------------------------------------------------------------------ */
{
  id: 'pgvector-distance-operators',
  module: 'pgvector',
  title: 'Distance Operators: L2, Inner Product, Cosine, L1, Hamming, Jaccard',
  level: 7,
  minutes: 24,
  summary: 'The math behind <->, <#>, <=>, <+>, <~> and <%>, when to use each, why <#> is negative, and how normalisation makes them agree.',
  objectives: [
    'Compute L2, inner product, cosine and L1 distances by hand and with pgvector',
    'Explain why <#> returns the NEGATIVE inner product',
    'Pick the operator that matches your embedding model and index operator class',
    'Use Hamming and Jaccard distance on bit vectors',
    'Show that all metrics agree on ranking for normalised vectors',
    'Convert distances into similarity scores for display'
  ],
  concept: `<p>pgvector <span class="tag ext">extension</span> gives every metric its own operator. All of them return a <strong>distance</strong>: <em>smaller = more similar</em>, so nearest-neighbour search is always <code>ORDER BY embedding OP query LIMIT k</code> (ascending).</p>
<table>
<tr><th>Operator</th><th>Metric</th><th>Formula (a, b vectors)</th><th>Range</th><th>Index opclass</th></tr>
<tr><td><code>&lt;-&gt;</code></td><td>Euclidean / L2 distance</td><td>sqrt( sum (a_i - b_i)^2 )</td><td>0 .. infinity</td><td><code>vector_l2_ops</code></td></tr>
<tr><td><code>&lt;#&gt;</code></td><td>Negative inner product</td><td>- sum a_i * b_i</td><td>-inf .. +inf</td><td><code>vector_ip_ops</code></td></tr>
<tr><td><code>&lt;=&gt;</code></td><td>Cosine distance</td><td>1 - (a . b) / (|a| |b|)</td><td>0 .. 2</td><td><code>vector_cosine_ops</code></td></tr>
<tr><td><code>&lt;+&gt;</code></td><td>Taxicab / L1 distance</td><td>sum |a_i - b_i|</td><td>0 .. infinity</td><td><code>vector_l1_ops</code> (HNSW)</td></tr>
<tr><td><code>&lt;~&gt;</code></td><td>Hamming distance (bit)</td><td>number of differing bits</td><td>0 .. n</td><td><code>bit_hamming_ops</code></td></tr>
<tr><td><code>&lt;%&gt;</code></td><td>Jaccard distance (bit)</td><td>1 - |a AND b| / |a OR b|</td><td>0 .. 1</td><td><code>bit_jaccard_ops</code> (HNSW)</td></tr>
</table>
<p><strong>Analogy - three ways to say two cities are "close".</strong> L2 is the straight-line (as the crow flies) distance. L1 is the Manhattan taxi distance - you can only drive along the grid, so you add up the east-west and north-south blocks. Cosine ignores how far away the cities are and only asks "do they lie in the same <em>compass direction</em> from the city centre?" - a town 10 km north-east and a town 300 km north-east count as identical. For text that is exactly what we want: a short tweet and a long article about the same topic point the same way even if the article's vector is longer.</p>
<h4>Why is &lt;#&gt; negative?</h4>
<p>Inner product is a <em>similarity</em> (bigger = more alike). PostgreSQL index scans return rows in ascending order of the operator result, so pgvector negates it: the most similar row has the most negative value and comes first in <code>ORDER BY embedding &lt;#&gt; q</code>. Multiply by -1 to display the real inner product.</p>
<h4>Normalised vectors: one ranking to rule them all</h4>
<p>If every vector has length 1 then |a - b|^2 = 2 - 2(a.b) and cosine similarity = a.b. So L2, inner product and cosine produce <strong>the same order</strong>. Inner product is the cheapest (no square root, no norm division), which is why pgvector's docs recommend <code>&lt;#&gt;</code> for normalised embeddings (e.g. OpenAI's).</p>
<h4>Which one should I use?</h4>
<ul>
<li><strong>Use whatever the model was trained for</strong> - the model card says "cosine" (most sentence-transformers), "dot product" (some retrieval models, e.g. those trained with MIPS objectives where length matters) or "L2".</li>
<li>Unsure and vectors are normalised -&gt; cosine (<code>&lt;=&gt;</code>) is safe; <code>&lt;#&gt;</code> is a free speed-up.</li>
<li>Image/feature vectors from CNNs, geographic-like features -&gt; L2 is common.</li>
<li>L1 is more robust to single outlier dimensions; used in some recommendation and sparse settings.</li>
<li>Binary codes (binary quantisation, perceptual hashes, fingerprints) -&gt; Hamming; sets of features as bits (tags, molecular fingerprints) -&gt; Jaccard.</li>
</ul>
<div class="callout warn">The operator in your query <strong>must match the operator class of the index</strong>. An index built with <code>vector_l2_ops</code> cannot serve <code>ORDER BY embedding &lt;=&gt; q</code>; PostgreSQL silently falls back to a sequential scan.</div>`,
  why: `<p>Different embedding models are trained with different similarity functions. Using the wrong one changes rankings (for non-normalised vectors) and silently degrades quality. Having distinct operators also lets PostgreSQL's planner match each query to the right index operator class.</p>`,
  useCase: `<p>A music-streaming company keeps two vector columns on <code>tracks</code>: a 512-d audio embedding trained with a dot-product objective (vector length encodes "energy/popularity" which they want to influence ranking) queried with <code>&lt;#&gt;</code>, and a normalised 384-d lyrics embedding queried with <code>&lt;=&gt;</code>. A third column stores a 64-bit perceptual audio fingerprint as <code>bit(64)</code> to detect duplicate uploads with <code>&lt;~&gt;</code> &lt;= 3 bits.</p>`,
  internals: `<p>Each operator is backed by a C function (<code>l2_distance</code>, <code>vector_negative_inner_product</code>, <code>cosine_distance</code>, <code>l1_distance</code>, <code>hamming_distance</code>, <code>jaccard_distance</code>). The loops are written so compilers auto-vectorise them (AVX/NEON). For cosine, pgvector computes dot product and both norms in one pass. If either vector has zero length, cosine distance is <code>NaN</code> - rows with NaN distances sort last. For HNSW with <code>vector_cosine_ops</code>, pgvector normalises vectors internally when building the graph; IVFFlat with cosine also normalises for the k-means step. Hamming uses popcount over 64-bit words, making it extremely fast.</p>`,
  whenNot: `<ul><li>Do not use inner product on non-normalised vectors unless the model was trained for it - long vectors will dominate results regardless of topic.</li>
<li>Do not mix operators between index and query.</li>
<li>Do not treat distances from different metrics or models as comparable thresholds ("cosine &lt; 0.2" for one model may be 0.35 for another).</li>
<li>Hamming on raw float embeddings makes no sense - quantise first.</li></ul>`,
  syntax: `a <-> b    -- L2 (Euclidean) distance          opclass vector_l2_ops
a <#> b    -- negative inner product            opclass vector_ip_ops
a <=> b    -- cosine distance (1 - cos sim)     opclass vector_cosine_ops
a <+> b    -- L1 (taxicab) distance             opclass vector_l1_ops
a <~> b    -- Hamming distance on bit(n)        opclass bit_hamming_ops
a <%> b    -- Jaccard distance on bit(n)        opclass bit_jaccard_ops

-- function forms: l2_distance(a,b), inner_product(a,b), cosine_distance(a,b),
--                 l1_distance(a,b), hamming_distance(a,b), jaccard_distance(a,b)`,
  examples: [
    { label: 'Basic', title: 'All four float metrics on one pair',
      sql: `CREATE EXTENSION IF NOT EXISTS vector;
SELECT '[1,2,3]'::vector <-> '[4,5,6]' AS l2,          -- sqrt(9+9+9)
       '[1,2,3]'::vector <#> '[4,5,6]' AS neg_inner,   -- -(4+10+18)
       ('[1,2,3]'::vector <#> '[4,5,6]') * -1 AS inner_product,
       '[1,2,3]'::vector <=> '[4,5,6]' AS cosine_dist, -- 1 - 32/(3.742*8.775)
       '[1,2,3]'::vector <+> '[4,5,6]' AS l1;          -- 3+3+3`,
      explain: `<p>Work it by hand: differences are (3,3,3). L2 = sqrt(27) = 5.196; L1 = 9. Inner product = 1*4+2*5+3*6 = 32, so <code>&lt;#&gt;</code> returns -32. Norms are sqrt(14)=3.742 and sqrt(77)=8.775, so cosine similarity = 32/32.83 = 0.9746 and cosine distance = 0.0254 - the vectors point in almost the same direction.</p>`,
      output: ` l2                | neg_inner | inner_product | cosine_dist          | l1
-------------------+-----------+---------------+----------------------+----
 5.196152422706632 |       -32 |            32 | 0.025368153802923787 |  9
(1 row)`,
      run: true },
    { label: 'Intermediate', title: 'Same data, different metric, different winner',
      sql: `CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE metric_demo (name text, v vector(2));
INSERT INTO metric_demo VALUES
  ('short, same direction', '[1, 1]'),
  ('long, same direction',  '[10, 10]'),
  ('close, other direction','[3, 1.5]');
-- query vector
WITH q AS (SELECT '[2, 2]'::vector AS v)
SELECT name,
       round((m.v <-> q.v)::numeric, 3) AS l2,
       round((m.v <#> q.v)::numeric, 3) AS neg_ip,
       round((m.v <=> q.v)::numeric, 3) AS cosine,
       rank() OVER (ORDER BY m.v <-> q.v) AS rank_l2,
       rank() OVER (ORDER BY m.v <#> q.v) AS rank_ip,
       rank() OVER (ORDER BY m.v <=> q.v) AS rank_cos
FROM metric_demo m, q
ORDER BY name;`,
      explain: `<p>With non-normalised vectors the metrics disagree. L2 prefers the point physically nearest (<code>[3,1.5]</code> at 1.118, then <code>[1,1]</code> at 1.414), inner product rewards length so <code>[10,10]</code> wins, and cosine treats both "same direction" rows as perfect (distance 0). This is exactly why you must use the metric your model was trained with - or normalise.</p>`,
      output: ` name                   | l2     | neg_ip  | cosine | rank_l2 | rank_ip | rank_cos
------------------------+--------+---------+--------+---------+---------+----------
 close, other direction | 1.118  |  -9.000 |  0.051 |       1 |       2 |        3
 long, same direction   | 11.314 | -40.000 |  0.000 |       3 |       1 |        1
 short, same direction  | 1.414  |  -4.000 |  0.000 |       2 |       3 |        1
(3 rows)`,
      run: true },
    { label: 'Advanced', title: 'Normalise once, then all metrics agree; Hamming and Jaccard on bits',
      sql: `CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE norm_demo (name text, v vector(2));
INSERT INTO norm_demo VALUES ('a','[1,1]'), ('b','[10,10]'), ('c','[3,1.5]'), ('d','[0.2,2]');
UPDATE norm_demo SET v = l2_normalize(v);          -- unit length

WITH q AS (SELECT l2_normalize('[2,2]'::vector) AS v)
SELECT name,
       rank() OVER (ORDER BY n.v <-> q.v) AS rank_l2,
       rank() OVER (ORDER BY n.v <#> q.v) AS rank_ip,
       rank() OVER (ORDER BY n.v <=> q.v) AS rank_cos
FROM norm_demo n, q ORDER BY name;

-- bit vectors: Hamming = differing bits, Jaccard = 1 - shared/union
SELECT B'10110010' <~> B'10011010' AS hamming,
       round((B'10110010' <%> B'10011010')::numeric, 3) AS jaccard;`,
      explain: `<p>After <code>l2_normalize</code> every vector has length 1, so L2, inner product and cosine rank rows identically (a and b become the same point). In production you normalise at write time and then use <code>&lt;#&gt;</code> with <code>vector_ip_ops</code> for the cheapest computation. The bit example: positions 3 and 5 differ, so Hamming = 2; set bits in common = 3 (positions 1,4,7), union = 5, Jaccard distance = 1 - 3/5 = 0.4.</p>`,
      output: ` name | rank_l2 | rank_ip | rank_cos
------+---------+---------+----------
 a    |       1 |       1 |        1
 b    |       1 |       1 |        1
 c    |       3 |       3 |        3
 d    |       4 |       4 |        4
(4 rows)

 hamming | jaccard
---------+---------
       2 |   0.400
(1 row)`,
      run: true }
  ],
  compare: {
    bad: { sql: `CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE op_bad (id int, e vector(3));
INSERT INTO op_bad SELECT g, ARRAY[random(),random(),random()]::vector FROM generate_series(1,2000) g;
CREATE INDEX ON op_bad USING hnsw (e vector_l2_ops);      -- L2 index
EXPLAIN (COSTS OFF)
SELECT id FROM op_bad ORDER BY e <=> '[1,0,0]' LIMIT 5;  -- cosine query`, why: 'The index was built for L2 but the query orders by cosine distance, so the planner cannot use the index and sorts all rows.', run: true },
    good: { sql: `CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE op_good (id int, e vector(3));
INSERT INTO op_good SELECT g, ARRAY[random(),random(),random()]::vector FROM generate_series(1,2000) g;
CREATE INDEX ON op_good USING hnsw (e vector_cosine_ops);  -- cosine index
EXPLAIN (COSTS OFF)
SELECT id FROM op_good ORDER BY e <=> '[1,0,0]' LIMIT 5;`, why: 'Operator and operator class match (<=> with vector_cosine_ops), so the plan is an Index Scan with Order By.', run: true }
  },
  mistakes: [
    'Sorting <code>ORDER BY embedding &lt;#&gt; q DESC</code> - <code>&lt;#&gt;</code> is already negated; ascending order gives the most similar rows (and DESC cannot use the index).',
    'Showing users "similarity = distance" - convert: cosine similarity = <code>1 - (a &lt;=&gt; b)</code>, inner product = <code>(a &lt;#&gt; b) * -1</code>.',
    'Building the index with one opclass and querying with another operator - silent sequential scan.',
    'Using cosine on vectors that can be all zeros - the result is NaN and those rows sort unpredictably; filter or fix them.',
    'Hard-coding a similarity threshold copied from a blog that used a different model.'
  ],
  best: [
    'Read the embedding model card and match its similarity function.',
    'Normalise vectors on write (<code>l2_normalize</code> or in the app) and use <code>&lt;#&gt;</code> + <code>vector_ip_ops</code> for speed.',
    'Keep one operator per column across indexes and queries; document it in a column comment.',
    'Use <code>ORDER BY distance LIMIT k</code> rather than <code>WHERE distance &lt; threshold</code> - thresholds cannot use the ANN index directly.',
    'Use binary (bit) codes only for a first pass, then re-rank with exact float distances.'
  ],
  performance: `<p>Per-distance cost: inner product &lt; L1 ~ L2 &lt; cosine (cosine also needs both norms). The difference is small next to I/O, but on brute-force scans of millions of rows inner product can be 10-30% faster. Hamming on <code>bit</code> is an order of magnitude faster than any float metric thanks to popcount and 32x less data. A <code>WHERE e &lt;-&gt; q &lt; 0.5</code> clause cannot be answered by HNSW/IVFFlat on its own: use <code>ORDER BY ... LIMIT</code> in a subquery and filter the small result.</p>`,
  security: ``,
  scenario: { title: 'Rankings look random after switching embedding providers', steps: [
    '1. Check the new model card: it may expect dot product on non-normalised vectors, or cosine.',
    '2. Check vector norms: SELECT avg(vector_norm(embedding)), stddev(vector_norm(embedding)) - are they ~1?',
    '3. Verify the index opclass (pg_get_indexdef) matches the operator in the query.',
    '4. Make sure queries are embedded by the same new model (not the old one cached in the app).',
    '5. Re-run the evaluation set and compare recall@10 per metric before deciding.'
  ] },
  widgets: ['lab:vector', 'diagram:vector-db'],
  interview: [
    { q: 'Why does pgvector return negative inner product?', a: 'Inner product is a similarity where larger means closer, but PostgreSQL ordered index scans return ascending values. Negating it lets ORDER BY embedding <#> q LIMIT k return the most similar rows first and use the vector_ip_ops index.' },
    { q: 'When do L2, cosine and inner product give the same ranking?', a: 'When all vectors are normalised to unit length. Then squared L2 equals 2 - 2*dot and cosine similarity equals dot, so all three are monotonic transformations of the dot product and rank identically.' },
    { q: 'How do you convert pgvector distances to a similarity score for a UI?', a: 'For cosine, similarity = 1 - (a <=> b), ranging 1 (identical direction) down to -1. For inner product, similarity = (a <#> b) * -1. For L2 there is no bounded similarity; teams use 1/(1+distance) or just show the rank.' },
    { q: 'What are Hamming and Jaccard distance used for in pgvector?', a: 'They operate on bit(n) values: Hamming counts differing bits and is used for binary-quantised embeddings or fingerprints; Jaccard compares sets encoded as bits. Both have HNSW opclasses (bit_hamming_ops, bit_jaccard_ops), and Hamming also works with IVFFlat.' }
  ],
  exercises: [
    { task: 'Compute by hand and verify with SQL: L1 and L2 distance between [0,0] and [3,4].',
      solution: `CREATE EXTENSION IF NOT EXISTS vector;
SELECT '[0,0]'::vector <+> '[3,4]' AS l1,   -- 7
       '[0,0]'::vector <-> '[3,4]' AS l2;   -- 5`, run: true },
    { task: 'Show cosine similarity (not distance) and real inner product between [1,0,1] and [1,1,0].',
      solution: `CREATE EXTENSION IF NOT EXISTS vector;
SELECT 1 - ('[1,0,1]'::vector <=> '[1,1,0]') AS cosine_similarity,   -- 0.5
       ('[1,0,1]'::vector <#> '[1,1,0]') * -1 AS inner_product;      -- 1`, run: true }
  ],
  challenge: { task: 'Write a query proving that for normalised vectors, squared L2 distance equals 2 * cosine distance, using three random 8-d vectors.',
    hint: 'Generate vectors with array_agg(random()), normalise with l2_normalize, then compare power(a <-> b, 2) with 2 * (a <=> b).',
    solution: `CREATE EXTENSION IF NOT EXISTS vector;
WITH v AS (
  SELECT g, l2_normalize((SELECT array_agg(random()::real) FROM generate_series(1,8) WHERE g > 0)::vector) AS e
  FROM generate_series(1,3) g
)
SELECT a.g AS a, b.g AS b,
       round(power(a.e <-> b.e, 2)::numeric, 6) AS l2_squared,
       round((2 * (a.e <=> b.e))::numeric, 6)   AS two_cosine_dist
FROM v a JOIN v b ON a.g < b.g;`, run: true },
  related: ['pgvector-install-types', 'pgvector-hnsw-index', 'vector-search-semantic-end-to-end', 'vector-search'],
  quiz: [
    { type: 'predict', q: 'Result?', code: `SELECT '[1,2]'::vector <#> '[3,4]'::vector;`, options: ['11', '-11', '2.83', '0.016'], answer: 1, explain: 'Inner product 1*3+2*4 = 11, negated by <#>.' },
    { type: 'mcq', q: 'Which operator computes cosine distance?', options: ['<->', '<#>', '<=>', '<+>'], answer: 2, explain: '<=> is cosine distance; <-> L2, <#> negative inner product, <+> L1.' },
    { type: 'index', q: 'Query: ORDER BY embedding <#> $1 LIMIT 10. Which index?', options: ['USING hnsw (embedding vector_l2_ops)', 'USING hnsw (embedding vector_cosine_ops)', 'USING hnsw (embedding vector_ip_ops)', 'USING gin (embedding)'], answer: 2, explain: '<#> requires the inner-product opclass vector_ip_ops.' },
    { type: 'tf', q: 'For unit-length vectors, ORDER BY e <-> q and ORDER BY e <#> q return rows in the same order.', answer: true, explain: 'Squared L2 = 2 - 2*dot for unit vectors, so both orderings are monotonic in the dot product.' },
    { type: 'bug', q: 'Why does this return the LEAST similar rows?', code: `SELECT id FROM docs ORDER BY embedding <#> $1 DESC LIMIT 5;`, options: ['<#> is not supported', 'DESC reverses the negated inner product; use ascending order', 'LIMIT must be 10', 'Needs cosine'], answer: 1, explain: '<#> is negative inner product, so ascending order puts the most similar first.' }
  ]
},
/* ------------------------------------------------------------------ */
{
  id: 'pgvector-hnsw-index',
  module: 'pgvector',
  title: 'HNSW Indexes: Navigable Small-World Graphs, m, ef_construction, ef_search',
  level: 7,
  minutes: 28,
  summary: 'How pgvector\'s HNSW index works as a multi-layer graph, what m / ef_construction / hnsw.ef_search do, and how to trade recall for latency and build memory.',
  objectives: [
    'Describe the multi-layer navigable small-world graph and how a search descends it',
    'Create HNSW indexes with the right operator class and parameters',
    'Tune hnsw.ef_search per query to trade recall for latency',
    'Size maintenance_work_mem and parallel workers for fast builds',
    'Measure recall@k of the index against an exact scan',
    'Recognise when the planner does or does not use the index'
  ],
  concept: `<p><strong>HNSW (Hierarchical Navigable Small World)</strong> is a graph-based approximate nearest-neighbour (ANN) index, available in <span class="tag ext">extension</span> pgvector since 0.5.0. Every row is a node; each node is linked to up to <code>m</code> close neighbours (2 x <code>m</code> on the bottom layer). The graph has several layers: the top layers are sparse "express highways", the bottom layer (layer 0) contains every vector.</p>
<p><strong>Analogy - travelling to a house in an unfamiliar country.</strong> You first take a flight between a handful of big hub cities (top layer), then a train between regional towns (middle layer), then walk street by street (layer 0). At each level you greedily move to whichever neighbour is closer to the destination, and drop a level when no neighbour is closer. You almost always arrive at (or right next to) the right house while visiting a tiny fraction of all houses.</p>
<h4>Search, step by step</h4>
<ol>
<li>Start at the fixed entry point on the highest layer.</li>
<li>Greedy walk: look at the current node's neighbours, move to the one closest to the query vector; repeat until no improvement.</li>
<li>Descend one layer and repeat, using the best node found as the new starting point.</li>
<li>On layer 0 run a <em>beam search</em> that keeps a candidate list of size <code>hnsw.ef_search</code> (default 40). The best <code>LIMIT k</code> results come from that list.</li>
</ol>
<h4>The three knobs</h4>
<table>
<tr><th>Parameter</th><th>Set where</th><th>Default</th><th>Effect</th></tr>
<tr><td><code>m</code></td><td><code>WITH (m = 16)</code> at CREATE INDEX</td><td>16</td><td>Max links per node per layer (layer 0: 2m). Higher = better recall, bigger index, slower build. Typical 12-48.</td></tr>
<tr><td><code>ef_construction</code></td><td><code>WITH (ef_construction = 64)</code></td><td>64</td><td>Candidate list size while inserting. Higher = better graph quality (recall), slower build. Must be &gt;= 2 x m.</td></tr>
<tr><td><code>hnsw.ef_search</code></td><td><code>SET</code> / <code>SET LOCAL</code> per session or transaction</td><td>40</td><td>Candidate list size at query time. Higher = better recall, higher latency. Also caps how many rows one scan returns (unless iterative scan is on).</td></tr>
</table>
<p><strong>Recall vs latency</strong> - recall@k is the fraction of the true k nearest neighbours that the index returned. Raising <code>ef_search</code> from 40 to 200 might lift recall@10 from 0.95 to 0.99 while doubling or tripling latency. Pick the lowest value that meets your quality target.</p>
<h4>Building</h4>
<ul>
<li>HNSW can be created on an <strong>empty table</strong> and maintained on every INSERT (unlike IVFFlat, it needs no training data). Inserts are slower than into a B-tree because each new node searches the graph to find neighbours.</li>
<li>Builds are much faster when the graph fits in <code>maintenance_work_mem</code>; pgvector prints a NOTICE "hnsw graph no longer fits into maintenance_work_mem after N tuples" when it does not, and continues more slowly on disk.</li>
<li>Since 0.6.0 builds run in parallel: set <code>max_parallel_maintenance_workers</code> (e.g. 7) and check <code>pg_stat_progress_create_index</code> for progress.</li>
<li>Use <code>CREATE INDEX CONCURRENTLY</code> on live tables to avoid blocking writes.</li>
</ul>`,
  why: `<p>Exact nearest-neighbour search compares the query with every row - O(N). At 10 million 768-d vectors that is ~30 GB of data per query. HNSW visits only a few thousand nodes (roughly logarithmic in N), turning seconds into milliseconds, at the price of occasionally missing a true neighbour. It became pgvector's default recommendation because it offers the best speed/recall trade-off, needs no training step and handles inserts gracefully.</p>`,
  useCase: `<p>A customer-support SaaS stores 12 million 768-d chunk embeddings (about 37 GB of vectors, HNSW index about 45 GB with m=16). On a 128 GB RAM server the index stays cached; p95 latency is 8 ms at <code>ef_search = 60</code> with recall@10 = 0.97 measured against exact search on 500 sampled queries. During the nightly bulk load of new tickets they build the index with <code>maintenance_work_mem = '16GB'</code> and 8 parallel workers - a rebuild that took 6 hours single-threaded finishes in under 1 hour.</p>`,
  internals: `<p>pgvector stores the HNSW graph in normal 8 KB index pages, WAL-logged and crash-safe like any PostgreSQL index. Each <em>element tuple</em> holds the vector (or halfvec/bit) and the heap TIDs; separate <em>neighbour tuples</em> hold the neighbour lists for each layer the element lives on. A node's top layer is chosen randomly with exponentially decaying probability (ml = 1/ln(m)), producing the hierarchy. Inserts lock affected pages; deletes are handled lazily: VACUUM must repair neighbour links that point to dead tuples, which makes VACUUM on heavily-updated HNSW indexes expensive (REINDEX CONCURRENTLY can be cheaper after mass deletes). Because a scan returns at most <code>ef_search</code> candidates, a <code>WHERE</code> filter applied afterwards can leave fewer than <code>LIMIT</code> rows - pgvector 0.8 adds iterative scans to fix this (see the IVFFlat lesson and vector-search filtering).</p>`,
  whenNot: `<ul><li>Tables with fewer than ~10-50k vectors: an exact scan is fast enough and always 100% recall.</li>
<li>When exact results are a hard requirement (legal discovery, deduplication thresholds) - use exact scans or re-rank a large candidate set.</li>
<li>Very write-heavy tables with constant updates of the vector column - index maintenance and VACUUM cost can dominate; consider IVFFlat, batching, or a separate embedding table.</li>
<li>Memory-starved servers where the index cannot stay mostly cached - random graph hops become random disk reads; consider halfvec/binary quantisation or IVFFlat.</li></ul>`,
  syntax: `CREATE INDEX [CONCURRENTLY] name ON table
  USING hnsw (column vector_cosine_ops)        -- or vector_l2_ops, vector_ip_ops, vector_l1_ops,
                                               -- halfvec_*_ops, sparsevec_*_ops, bit_hamming_ops, bit_jaccard_ops
  WITH (m = 16, ef_construction = 64);

SET maintenance_work_mem = '8GB';              -- build memory
SET max_parallel_maintenance_workers = 7;      -- parallel build (pgvector 0.6+)

SET hnsw.ef_search = 100;                      -- query-time recall knob (default 40)
BEGIN; SET LOCAL hnsw.ef_search = 200; SELECT ...; COMMIT;   -- per transaction`,
  examples: [
    { label: 'Basic', title: 'Create an HNSW index and confirm the planner uses it',
      sql: ITEMS_16 + `
CREATE INDEX items_hnsw ON items USING hnsw (embedding vector_l2_ops)
  WITH (m = 16, ef_construction = 64);

EXPLAIN (COSTS OFF)
SELECT id FROM items
ORDER BY embedding <-> (SELECT embedding FROM items WHERE id = 1)
LIMIT 10;`,
      explain: `<p>The setup generates 5,000 random 16-d vectors (seeded with <code>setseed</code> so results repeat). The index uses <code>vector_l2_ops</code>, matching the <code>&lt;-&gt;</code> operator in the query. The plan shows <code>Index Scan using items_hnsw</code> with <code>Order By</code> - the index itself produces rows in approximate distance order, and <code>Limit</code> stops after 10. The InitPlan fetches the query vector of row 1 once.</p>`,
      output: `Limit
  InitPlan 1
    ->  Seq Scan on items items_1
          Filter: (id = 1)
  ->  Index Scan using items_hnsw on items
        Order By: (embedding <-> (InitPlan 1).col1)`,
      run: true },
    { label: 'Intermediate', title: 'Measure recall@10 for different hnsw.ef_search values',
      sql: ITEMS_16 + `
CREATE INDEX items_hnsw ON items USING hnsw (embedding vector_l2_ops) WITH (m = 4, ef_construction = 8);

-- ground truth: exact top-10 for 20 query vectors (index disabled)
SET enable_indexscan = off;
CREATE TEMP TABLE truth AS
SELECT q.id AS qid, nn.id
FROM items q
CROSS JOIN LATERAL (SELECT i.id FROM items i ORDER BY i.embedding <-> q.embedding LIMIT 10) nn
WHERE q.id <= 20;
RESET enable_indexscan;

-- approximate top-10 with a small and a large candidate list
SET hnsw.ef_search = 10;
CREATE TEMP TABLE ann_10 AS
SELECT q.id AS qid, nn.id FROM items q
CROSS JOIN LATERAL (SELECT i.id FROM items i ORDER BY i.embedding <-> q.embedding LIMIT 10) nn
WHERE q.id <= 20;
SET hnsw.ef_search = 100;
CREATE TEMP TABLE ann_100 AS
SELECT q.id AS qid, nn.id FROM items q
CROSS JOIN LATERAL (SELECT i.id FROM items i ORDER BY i.embedding <-> q.embedding LIMIT 10) nn
WHERE q.id <= 20;

SELECT 'ef_search=10'  AS setting, round(count(a.id) / 200.0, 3) AS recall_at_10
FROM truth t LEFT JOIN ann_10 a USING (qid, id)
UNION ALL
SELECT 'ef_search=100', round(count(a.id) / 200.0, 3)
FROM truth t LEFT JOIN ann_100 a USING (qid, id);`,
      explain: `<p>This is the standard way to evaluate an ANN index: compute the exact answer with index scans disabled (<code>SET enable_indexscan = off</code> forces a sort over all rows), compute the approximate answer with the index, and count overlaps. 20 queries x 10 neighbours = 200 expected ids. We deliberately build a weak graph (<code>m = 4, ef_construction = 8</code>) so that the effect of <code>ef_search</code> is visible: a candidate list of 10 misses neighbours, 100 recovers almost all of them. Exact numbers vary slightly with the random data.</p>`,
      output: ` setting       | recall_at_10
---------------+--------------
 ef_search=10  |        0.555
 ef_search=100 |        0.865
(2 rows)   -- example run; values vary slightly with the random data and graph`,
      run: true },
    { label: 'Advanced', title: 'Build parameters vs index size; build memory settings',
      sql: ITEMS_16 + `
SET maintenance_work_mem = '256MB';          -- graph should fit in memory for a fast build
SET max_parallel_maintenance_workers = 2;    -- parallel HNSW build (pgvector >= 0.6)

CREATE INDEX items_hnsw_m8  ON items USING hnsw (embedding vector_l2_ops) WITH (m = 8,  ef_construction = 32);
CREATE INDEX items_hnsw_m32 ON items USING hnsw (embedding vector_l2_ops) WITH (m = 32, ef_construction = 128);

SELECT c.relname AS index_name,
       c.reloptions,
       pg_size_pretty(pg_relation_size(c.oid)) AS size
FROM   pg_class c
WHERE  c.relname IN ('items_hnsw_m8', 'items_hnsw_m32')
UNION ALL
SELECT 'items (heap)', NULL, pg_size_pretty(pg_relation_size('items'));`,
      explain: `<p>Quadrupling <code>m</code> multiplies the neighbour-list storage, so the m=32 index is about twice the size of the m=8 one - and both are larger than the table itself for these small 16-d vectors (with 768-d vectors the vector data dominates and the index is closer to the table size). <code>reloptions</code> records the parameters. For real builds: give <code>maintenance_work_mem</code> enough to hold the whole graph (roughly the final index size), raise <code>max_parallel_maintenance_workers</code>, and watch <code>pg_stat_progress_create_index</code> from another session.</p>`,
      output: ` index_name     | reloptions                 | size
----------------+----------------------------+---------
 items_hnsw_m8  | {m=8,ef_construction=32}   | 1320 kB
 items_hnsw_m32 | {m=32,ef_construction=128} | 2760 kB
 items (heap)   |                            | 1024 kB
(3 rows)`,
      run: true }
  ],
  compare: {
    bad: { sql: ITEMS_16 + `
CREATE INDEX ON items USING hnsw (embedding vector_l2_ops);
-- distance threshold instead of ORDER BY ... LIMIT: the HNSW index cannot be used
EXPLAIN (COSTS OFF)
SELECT id FROM items
WHERE embedding <-> '[0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5]' < 0.9;`, why: 'HNSW only accelerates ORDER BY distance LIMIT k. A WHERE distance < x predicate is evaluated row by row with a sequential scan.', run: true },
    good: { sql: ITEMS_16 + `
CREATE INDEX ON items USING hnsw (embedding vector_l2_ops);
EXPLAIN (COSTS OFF)
SELECT id, dist FROM (
  SELECT id, embedding <-> '[0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5]' AS dist
  FROM items
  ORDER BY embedding <-> '[0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5]'
  LIMIT 20
) nn
WHERE dist < 0.9;`, why: 'Get the k nearest via the index (ORDER BY ... LIMIT), then apply the threshold to that small result.', run: true }
  },
  mistakes: [
    'Creating the index with <code>vector_l2_ops</code> while queries use <code>&lt;=&gt;</code> (cosine) - the index is ignored.',
    'Leaving <code>maintenance_work_mem</code> at the 64 MB default for a multi-GB build - the graph spills and the build is many times slower.',
    'Expecting more than <code>hnsw.ef_search</code> rows from a filtered query - without iterative scan a scan returns at most ef_search candidates before filtering.',
    'Setting <code>ef_construction</code> below <code>2 * m</code> (rejected) or very high values "for safety" that only slow the build.',
    'Building HNSW synchronously on a busy production table without <code>CONCURRENTLY</code>, blocking all writes for hours.',
    'Never measuring recall - assuming "approximate" means "nearly perfect" for your data.'
  ],
  best: [
    'Start with defaults (m=16, ef_construction=64, ef_search=40); tune <code>ef_search</code> first since it needs no rebuild.',
    'Use <code>SET LOCAL hnsw.ef_search</code> inside a transaction for per-request quality levels (e.g. higher for premium search).',
    'Load data first, then build the index with high <code>maintenance_work_mem</code> and parallel workers; use CONCURRENTLY on live systems.',
    'Keep the index in RAM: monitor <code>pg_relation_size</code> of the index versus <code>shared_buffers</code> + OS cache; use halfvec to halve it.',
    'Track recall@k with a fixed evaluation query set after every parameter, model or data change.'
  ],
  performance: `<p>Latency grows roughly with <code>ef_search</code> x m x distance cost, and with cache misses. Rules of thumb: index size ~ table vector size + m-dependent link overhead; build time grows with ef_construction and m; recall saturates - going from ef_search 100 to 400 usually buys &lt;1% recall at 3-4x the latency. Inserts into HNSW cost ~1-10 ms each for large graphs, so bulk loads should happen before the index build. After large DELETEs, VACUUM has to repair the graph (slow); REINDEX CONCURRENTLY is often faster.</p>`,
  security: `<p>HNSW indexes contain full copies of the vectors. Anyone with access to raw data files or backups can read them; protect backups and storage the same as table data. Row Level Security is applied after the index scan, so a restrictive policy can reduce returned rows below LIMIT - enable iterative scans or use partial/partitioned indexes per tenant.</p>`,
  scenario: { title: 'Search quality complaints after 10x data growth', steps: [
    '1. Re-run your recall@10 evaluation: recall often drops as the graph grows with fixed ef_search.',
    '2. Raise hnsw.ef_search (40 -> 100) and measure latency; this is free (no rebuild).',
    '3. If recall is still low, rebuild with higher m (16 -> 24) and ef_construction (64 -> 128) using REINDEX CONCURRENTLY with generous maintenance_work_mem.',
    '4. Check the index still fits in memory (pg_relation_size vs RAM); if not, move to halfvec or add RAM.',
    '5. Check filtered queries: enable hnsw.iterative_scan (pgvector 0.8+) if results come back short.'
  ] },
  widgets: ['lab:vector', 'diagram:vector-db'],
  interview: [
    { q: 'Explain HNSW in 30 seconds.', a: 'HNSW builds a multi-layer proximity graph: upper layers are sparse long-range links, the bottom layer contains every vector linked to its m nearest neighbours. A query greedily walks from the top entry point toward the query vector, descending layers, and finishes with a beam search of size ef_search on the bottom layer. It visits a tiny fraction of nodes, giving millisecond searches with high but not perfect recall.' },
    { q: 'What do m, ef_construction and ef_search control?', a: 'm is the maximum number of neighbours per node per layer (graph density, index size, recall). ef_construction is the candidate list size used while inserting, improving graph quality at the cost of build time. hnsw.ef_search is the query-time candidate list; raising it increases recall and latency and can be changed per session without rebuilding.' },
    { q: 'Why might a filtered HNSW query return fewer rows than LIMIT?', a: 'The index scan produces at most ef_search candidates; the WHERE filter is applied afterwards, so if most candidates fail the filter, fewer than LIMIT rows remain. Fixes: raise ef_search, enable hnsw.iterative_scan in pgvector 0.8+, or use partial or partitioned indexes for selective filters.' },
    { q: 'HNSW or IVFFlat for a table that grows continuously?', a: 'HNSW. It needs no training data, keeps quality as rows are inserted, and generally offers better recall/latency trade-offs. IVFFlat centroids are computed at build time and degrade as the data distribution drifts, requiring periodic rebuilds.' }
  ],
  exercises: [
    { task: 'Create a cosine HNSW index with m = 24 and ef_construction = 100 on a new table docs_emb(id int, e vector(3)) and show its definition.',
      solution: `CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE docs_emb (id int PRIMARY KEY, e vector(3));
CREATE INDEX docs_emb_hnsw ON docs_emb USING hnsw (e vector_cosine_ops) WITH (m = 24, ef_construction = 100);
SELECT pg_get_indexdef('docs_emb_hnsw'::regclass);`, run: true },
    { task: 'Raise hnsw.ef_search to 120 only for the current transaction and show the value.',
      solution: `CREATE EXTENSION IF NOT EXISTS vector;
BEGIN;
SET LOCAL hnsw.ef_search = 120;
SHOW hnsw.ef_search;
COMMIT;`, run: true }
  ],
  challenge: { task: 'Using the 5,000-row items table, find the smallest hnsw.ef_search among 10, 40, 100, 200 that achieves recall@10 >= 0.9 for query id 1 with a weak index (m = 4, ef_construction = 8).',
    hint: 'Store the exact top-10 in a temp table with enable_indexscan off, then repeat the approximate query for each setting and count overlaps.',
    solution: ITEMS_16 + `
CREATE INDEX ON items USING hnsw (embedding vector_l2_ops) WITH (m = 4, ef_construction = 8);
SET enable_indexscan = off;
CREATE TEMP TABLE exact AS SELECT id FROM items ORDER BY embedding <-> (SELECT embedding FROM items WHERE id = 1) LIMIT 10;
RESET enable_indexscan;
CREATE TEMP TABLE results (ef int, hits int);
SET hnsw.ef_search = 10;
INSERT INTO results SELECT 10, count(*) FROM exact JOIN (SELECT id FROM items ORDER BY embedding <-> (SELECT embedding FROM items WHERE id = 1) LIMIT 10) a USING (id);
SET hnsw.ef_search = 40;
INSERT INTO results SELECT 40, count(*) FROM exact JOIN (SELECT id FROM items ORDER BY embedding <-> (SELECT embedding FROM items WHERE id = 1) LIMIT 10) a USING (id);
SET hnsw.ef_search = 100;
INSERT INTO results SELECT 100, count(*) FROM exact JOIN (SELECT id FROM items ORDER BY embedding <-> (SELECT embedding FROM items WHERE id = 1) LIMIT 10) a USING (id);
SET hnsw.ef_search = 200;
INSERT INTO results SELECT 200, count(*) FROM exact JOIN (SELECT id FROM items ORDER BY embedding <-> (SELECT embedding FROM items WHERE id = 1) LIMIT 10) a USING (id);
SELECT ef, hits / 10.0 AS recall FROM results ORDER BY ef;
SELECT min(ef) AS smallest_ok_ef_search FROM results WHERE hits >= 9;   -- NULL means none reached 0.9`, run: true },
  related: ['pgvector-ivfflat-index', 'pgvector-distance-operators', 'vector-search-recall-tuning', 'indexes'],
  quiz: [
    { type: 'mcq', q: 'Which setting can be changed at query time without rebuilding an HNSW index?', options: ['m', 'ef_construction', 'hnsw.ef_search', 'lists'], answer: 2, explain: 'hnsw.ef_search is a GUC; m and ef_construction are fixed at build time.' },
    { type: 'tf', q: 'An HNSW index can be created on an empty table and stays good as rows are inserted.', answer: true, explain: 'HNSW needs no training step; each insert links the new node into the graph.' },
    { type: 'scenario', q: 'A 20M-row HNSW build is extremely slow and logs "hnsw graph no longer fits into maintenance_work_mem". Best fix?', options: ['Lower m to 4', 'Increase maintenance_work_mem (and parallel workers) for the build session', 'Switch to a B-tree', 'Increase work_mem'], answer: 1, explain: 'The build is fast only while the graph fits in maintenance_work_mem; work_mem is irrelevant.' },
    { type: 'optimize', q: 'Recall@10 is 0.88 and latency budget allows 2x. First thing to try?', code: `SHOW hnsw.ef_search;  -- 40`, options: ['REINDEX with m=64', 'SET hnsw.ef_search = 80..100 and re-measure', 'Switch to IVFFlat', 'Disable the index'], answer: 1, explain: 'ef_search is the cheapest knob: no rebuild, immediate effect on recall and latency.' },
    { type: 'predict', q: 'With default settings and no iterative scan, at most how many candidate rows does one HNSW scan return?', code: `SELECT id FROM items WHERE category = 'pets' ORDER BY embedding <-> $1 LIMIT 100;`, options: ['100', '40 (ef_search)', 'All rows', '16 (m)'], answer: 1, explain: 'The scan returns up to ef_search (default 40) candidates; the filter then may remove some, and LIMIT 100 cannot be satisfied.' }
  ]
},
/* ------------------------------------------------------------------ */
{
  id: 'pgvector-ivfflat-index',
  module: 'pgvector',
  title: 'IVFFlat Indexes, HNSW vs IVFFlat, and Iterative Index Scans',
  level: 7,
  minutes: 26,
  summary: 'IVFFlat clusters vectors into k-means lists and searches only the nearest probes; compare it with HNSW and use pgvector 0.8 iterative scans for filtered queries.',
  objectives: [
    'Explain IVFFlat: k-means centroids, inverted lists and probes',
    'Choose lists (rows/1000 up to 1M rows, sqrt(rows) above) and ivfflat.probes',
    'Know why IVFFlat must be built AFTER loading representative data',
    'Compare HNSW and IVFFlat on build time, memory, recall, updates',
    'Use hnsw.iterative_scan / ivfflat.iterative_scan (pgvector 0.8) for filtered vector queries',
    'Tune max_scan_tuples / max_probes safety limits'
  ],
  concept: `<p><strong>IVFFlat</strong> (Inverted File with Flat storage) is pgvector's <span class="tag ext">extension</span> first ANN index. At build time it runs <strong>k-means</strong> on a sample of the table to find <code>lists</code> centroids, then assigns every vector to its nearest centroid's list. At query time it compares the query vector with all centroids, picks the <code>ivfflat.probes</code> nearest lists (default 1), and scans only the vectors in those lists exactly ("flat" = no compression).</p>
<p><strong>Analogy - a library with themed shelves.</strong> A librarian groups 1 million books onto 1,000 themed shelves (k-means). To find books like the one in your hand, you check which shelf themes look closest and only browse those shelves (probes). Browse 1 shelf: very fast but you miss a relevant book shelved next door. Browse 10 shelves: slower but you find almost everything. If the shelves were organised before most books arrived, the themes are wrong and shelves are lopsided - that is why IVFFlat must be built <em>after</em> loading data.</p>
<h4>Choosing parameters (pgvector guidance)</h4>
<ul>
<li><code>lists</code> = rows / 1000 for up to 1M rows; <code>sqrt(rows)</code> above 1M. Example: 500k rows -&gt; 500 lists; 4M rows -&gt; 2000 lists.</li>
<li><code>ivfflat.probes</code> start at sqrt(lists): 500 lists -&gt; ~22 probes. probes = lists means an exact (but slower than seq-scan) search.</li>
<li>Rebuild (REINDEX) when the data distribution changes significantly - centroids never move after the build.</li>
</ul>
<h4>HNSW vs IVFFlat</h4>
<table>
<tr><th></th><th>HNSW</th><th>IVFFlat</th></tr>
<tr><td>Structure</td><td>Multi-layer proximity graph</td><td>k-means centroids + inverted lists</td></tr>
<tr><td>Needs data before build</td><td>No (works on empty table)</td><td>Yes (centroids learned from existing rows)</td></tr>
<tr><td>Build time</td><td>Slower (minutes to hours)</td><td>Faster (often 5-30x)</td></tr>
<tr><td>Build memory</td><td>High (graph in maintenance_work_mem)</td><td>Lower</td></tr>
<tr><td>Index size</td><td>Larger</td><td>Smaller (about vector data + small overhead)</td></tr>
<tr><td>Query speed at same recall</td><td>Better</td><td>Worse, especially at high recall</td></tr>
<tr><td>Query knob</td><td><code>hnsw.ef_search</code> (default 40)</td><td><code>ivfflat.probes</code> (default 1)</td></tr>
<tr><td>Inserts / drift</td><td>Graceful</td><td>Recall degrades as distribution drifts; periodic rebuild</td></tr>
<tr><td>Max dims</td><td>2000 vector / 4000 halfvec / 64000 bit / 1000 nnz sparsevec</td><td>2000 vector / 4000 halfvec / 64000 bit; no sparsevec</td></tr>
<tr><td>Operators</td><td>L2, IP, cosine, L1, Hamming, Jaccard</td><td>L2, IP, cosine, Hamming</td></tr>
</table>
<h4>Iterative index scans (pgvector 0.8.0+)</h4>
<p>Classic problem: <code>WHERE category = 'pets' ORDER BY embedding &lt;-&gt; q LIMIT 10</code>. The index returns ~ef_search (or probes worth of) nearest vectors <em>regardless of category</em>; if only 20% are pets, you may get 2-8 rows instead of 10 (<strong>overfiltering</strong>). With <code>SET hnsw.iterative_scan = strict_order</code> (or <code>relaxed_order</code>) the index keeps scanning further until enough rows pass the filter or a limit is reached:</p>
<ul>
<li><code>hnsw.iterative_scan = off | relaxed_order | strict_order</code>; safety cap <code>hnsw.max_scan_tuples</code> (default 20,000) and <code>hnsw.scan_mem_multiplier</code>.</li>
<li><code>ivfflat.iterative_scan = off | relaxed_order</code>; cap <code>ivfflat.max_probes</code>.</li>
<li><code>relaxed_order</code> may return results slightly out of order (faster); wrap in a materialized CTE and re-sort if exact order matters.</li>
</ul>`,
  why: `<p>IVFFlat was the first ANN index in pgvector and is still useful when build time and memory matter more than peak query performance - e.g. nightly rebuilt catalogues, or very large static datasets where an HNSW build would take too long. Iterative scans solve the most common production complaint with both index types: filtered vector queries returning too few rows.</p>`,
  useCase: `<p>An image-similarity service rebuilds its 30M-row product-image index every night from a warehouse export. HNSW builds took 9 hours; IVFFlat with <code>lists = 5500</code> (~sqrt(30M)) builds in 50 minutes with 4 GB of memory. With <code>ivfflat.probes = 60</code> they reach recall@20 = 0.93 at 25 ms - acceptable for "similar products" carousels. For the filtered "similar products in the same brand" query they enable <code>ivfflat.iterative_scan = relaxed_order</code> so results are never short.</p>`,
  internals: `<p>Build: pgvector samples rows, runs k-means (Elkan's algorithm) in memory to compute <code>lists</code> centroids (with cosine, vectors are normalised first), writes centroid pages, then scans the table assigning each tuple to the nearest centroid list (list pages are chained). Query: compute distance to every centroid, keep the nearest <code>probes</code> lists in a heap, read every tuple in those lists, compute exact distances, and return them sorted via a tuplesort. Because centroids are fixed, new rows go into whichever existing list is nearest - if new data clusters somewhere new, lists become unbalanced and recall drops. If you build on an empty or tiny table, pgvector warns "ivfflat index created with little data" and recall will be poor.</p>`,
  whenNot: `<ul><li>Continuously changing data whose distribution drifts (new product categories, new languages) - prefer HNSW.</li>
<li>When very high recall (0.98+) at low latency is required - HNSW typically wins.</li>
<li>Empty or small tables - build after loading; below ~50k rows prefer an exact scan.</li>
<li>sparsevec or L1/Jaccard metrics - only HNSW supports them.</li></ul>`,
  syntax: `CREATE INDEX name ON table USING ivfflat (column vector_l2_ops)   -- or vector_ip_ops, vector_cosine_ops,
  WITH (lists = 1000);                                              -- halfvec_*_ops, bit_hamming_ops

SET ivfflat.probes = 32;                  -- lists to search (default 1)

-- pgvector 0.8+: keep scanning until filtered LIMIT is satisfied
SET hnsw.iterative_scan    = strict_order;   -- off | relaxed_order | strict_order
SET hnsw.max_scan_tuples   = 20000;
SET ivfflat.iterative_scan = relaxed_order;  -- off | relaxed_order
SET ivfflat.max_probes     = 100;`,
  examples: [
    { label: 'Basic', title: 'Build IVFFlat after loading data, sized with rows/1000',
      sql: ITEMS_16 + `
-- 5,000 rows -> rows/1000 = 5; we use 50 lists to make probes effects visible
CREATE INDEX items_ivf ON items USING ivfflat (embedding vector_l2_ops) WITH (lists = 50);
SET ivfflat.probes = 5;

EXPLAIN (COSTS OFF)
SELECT id FROM items
ORDER BY embedding <-> (SELECT embedding FROM items WHERE id = 1)
LIMIT 5;`,
      explain: `<p>The table is populated first, then the index is built so k-means sees representative data. The rows/1000 heuristic would give 5 lists for 5,000 rows; we use 50 to make the probes trade-off visible in the next example. <code>ivfflat.probes = 5</code> searches the 5 lists whose centroids are closest to the query. The plan is the same shape as HNSW: an Index Scan with <code>Order By</code>.</p>`,
      output: `Limit
  InitPlan 1
    ->  Seq Scan on items items_1
          Filter: (id = 1)
  ->  Index Scan using items_ivf on items
        Order By: (embedding <-> (InitPlan 1).col1)`,
      run: true },
    { label: 'Intermediate', title: 'probes vs recall: 1, 5, 20, 50 lists',
      sql: ITEMS_16 + `
CREATE INDEX items_ivf ON items USING ivfflat (embedding vector_l2_ops) WITH (lists = 50);
SET enable_indexscan = off;
CREATE TEMP TABLE exact AS
SELECT id FROM items ORDER BY embedding <-> (SELECT embedding FROM items WHERE id = 1) LIMIT 10;
RESET enable_indexscan;
CREATE TEMP TABLE results (probes int, hits int);
SET ivfflat.probes = 1;
INSERT INTO results SELECT 1, count(*) FROM exact JOIN (SELECT id FROM items ORDER BY embedding <-> (SELECT embedding FROM items WHERE id = 1) LIMIT 10) a USING (id);
SET ivfflat.probes = 5;
INSERT INTO results SELECT 5, count(*) FROM exact JOIN (SELECT id FROM items ORDER BY embedding <-> (SELECT embedding FROM items WHERE id = 1) LIMIT 10) a USING (id);
SET ivfflat.probes = 20;
INSERT INTO results SELECT 20, count(*) FROM exact JOIN (SELECT id FROM items ORDER BY embedding <-> (SELECT embedding FROM items WHERE id = 1) LIMIT 10) a USING (id);
SET ivfflat.probes = 50;
INSERT INTO results SELECT 50, count(*) FROM exact JOIN (SELECT id FROM items ORDER BY embedding <-> (SELECT embedding FROM items WHERE id = 1) LIMIT 10) a USING (id);
SELECT probes, hits AS found_of_10, hits / 10.0 AS recall_at_10 FROM results ORDER BY probes;`,
      explain: `<p>With 1 probe only one list (about 100 of 5,000 vectors) is scanned, so many true neighbours that sit in adjacent lists are missed. Recall climbs as probes increase; probes = lists (50) scans everything and is exact. Uniformly random 16-d data is a hard case for clustering - real embeddings cluster much better, so recall at small probe counts is usually higher.</p>`,
      output: ` probes | found_of_10 | recall_at_10
--------+-------------+--------------
      1 |           4 |          0.4
      5 |           9 |          0.9
     20 |          10 |          1.0
     50 |          10 |          1.0
(4 rows)   -- example run; values vary with the random data`,
      run: true },
    { label: 'Advanced', title: 'Overfiltering and the pgvector 0.8 iterative scan fix',
      sql: `CREATE EXTENSION IF NOT EXISTS vector;
SELECT setseed(0.1);
CREATE TABLE catalog AS
SELECT g AS id,
       (ARRAY['books','music','video','toys','food','tools','games','garden','auto','pets'])[1 + g % 10] AS category,
       (SELECT array_agg(random()::real) FROM generate_series(1, 8) WHERE g > 0)::vector(8) AS embedding
FROM generate_series(1, 5000) g;
CREATE INDEX ON catalog USING hnsw (embedding vector_l2_ops);
ANALYZE catalog;

SET hnsw.ef_search = 20;
SET hnsw.iterative_scan = off;
SELECT 'iterative_scan=off' AS mode, count(*) AS rows_returned
FROM (SELECT id FROM catalog WHERE category = 'pets'
      ORDER BY embedding <-> '[0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5]' LIMIT 10) s;

SET hnsw.iterative_scan = strict_order;
SELECT 'iterative_scan=strict_order' AS mode, count(*) AS rows_returned
FROM (SELECT id FROM catalog WHERE category = 'pets'
      ORDER BY embedding <-> '[0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5]' LIMIT 10) s;`,
      explain: `<p>Only 10% of rows are <code>pets</code>. With <code>ef_search = 20</code> the HNSW scan yields ~20 nearest vectors of <em>any</em> category, the filter keeps the pets among them, and the query returns fewer than the 10 rows requested - a silent quality bug. With <code>hnsw.iterative_scan = strict_order</code> (pgvector 0.8+) the scan resumes and explores more of the graph until 10 matching rows are found (or <code>hnsw.max_scan_tuples</code> is hit). <code>relaxed_order</code> is faster but may return slightly out-of-order rows.</p>`,
      output: ` mode               | rows_returned
--------------------+---------------
 iterative_scan=off |             1
(1 row)

 mode                        | rows_returned
-----------------------------+---------------
 iterative_scan=strict_order |            10
(1 row)`,
      run: true }
  ],
  compare: {
    bad: { sql: `CREATE EXTENSION IF NOT EXISTS vector;
-- index built on an EMPTY table: k-means has nothing to learn from
CREATE TABLE ivf_bad (id int, e vector(3));
CREATE INDEX ON ivf_bad USING ivfflat (e vector_l2_ops) WITH (lists = 10);
INSERT INTO ivf_bad SELECT g, ARRAY[random(),random(),random()]::vector FROM generate_series(1, 3000) g;
SELECT count(*) FROM ivf_bad;`, why: 'Building IVFFlat before loading data produces meaningless centroids (pgvector warns: "ivfflat index created with little data"); recall stays poor until REINDEX.', run: true },
    good: { sql: `CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE ivf_good (id int, e vector(3));
INSERT INTO ivf_good SELECT g, ARRAY[random(),random(),random()]::vector FROM generate_series(1, 3000) g;
-- load first, then train the centroids on real data
CREATE INDEX ON ivf_good USING ivfflat (e vector_l2_ops) WITH (lists = 10);
SELECT count(*) FROM ivf_good;`, why: 'Centroids reflect the actual distribution, so lists are balanced and probes find true neighbours.', run: true }
  },
  mistakes: [
    'Creating an IVFFlat index on an empty table during schema migration, then loading data.',
    'Leaving <code>ivfflat.probes</code> at the default 1 - recall is often poor; start at sqrt(lists).',
    'Using too many lists for the data size (lists close to rows) - each list holds a handful of vectors and probes must be huge.',
    'Never rebuilding IVFFlat after the dataset doubles or shifts topics.',
    'Assuming iterative scans are on by default - in pgvector 0.8 they are <code>off</code> unless you SET them.',
    'Using <code>relaxed_order</code> and showing results without re-sorting when strict order matters.'
  ],
  best: [
    'Load (or at least a representative sample), then CREATE INDEX ... USING ivfflat WITH (lists = rows/1000 or sqrt(rows)).',
    'Tune <code>ivfflat.probes</code> with a recall evaluation; set it per transaction with SET LOCAL.',
    'Schedule REINDEX CONCURRENTLY for IVFFlat after major data growth or drift.',
    'Prefer HNSW by default; choose IVFFlat when build time/memory dominate and data is mostly static.',
    'Enable <code>hnsw.iterative_scan</code>/<code>ivfflat.iterative_scan</code> for filtered queries, and keep <code>max_scan_tuples</code>/<code>max_probes</code> as safety caps.'
  ],
  performance: `<p>IVFFlat query cost ~ (lists centroid comparisons) + (probes x rows/lists exact comparisons). With 1M rows, 1000 lists and 32 probes that is 1,000 + 32,000 distance computations - far fewer than 1M, but more than HNSW typically needs for the same recall. Builds are memory-light and fast, and index size is close to the raw vector data. Iterative scans add work only when filters remove many rows; cap it with <code>hnsw.max_scan_tuples</code> / <code>ivfflat.max_probes</code> to avoid worst-case full scans on very selective filters (for those, a B-tree on the filter column plus exact distance may be faster).</p>`,
  security: `<p>Same as other indexes: vector data is copied into the index and into backups. Filtered queries enforced by RLS suffer from overfiltering just like WHERE filters - enable iterative scans so tenants do not receive silently truncated result sets.</p>`,
  scenario: { title: 'Choosing an index for 50M product embeddings rebuilt weekly', steps: [
    '1. Estimate HNSW build: 50M x 768-d halfvec ~ 77 GB graph; needs very large maintenance_work_mem and hours.',
    '2. Estimate IVFFlat: lists = sqrt(50M) ~ 7000; build in under an hour with modest memory.',
    '3. Benchmark both on a 5M sample: recall@20 vs p95 latency at several ef_search / probes values.',
    '4. If IVFFlat meets the target (e.g. recall 0.92 at 30 ms with probes 80) and data is static between rebuilds, use it; otherwise HNSW with parallel build.',
    '5. Enable iterative scan for brand/category-filtered queries and re-measure.'
  ] },
  widgets: ['lab:vector'],
  interview: [
    { q: 'How does IVFFlat find neighbours?', a: 'At build time it runs k-means to create lists centroids and assigns each vector to its nearest centroid. At query time it computes the distance to all centroids, scans only the ivfflat.probes closest lists exhaustively, and returns the best rows. More probes means higher recall and higher latency.' },
    { q: 'Why must IVFFlat be built after data is loaded?', a: 'Its centroids are learned from the rows present at build time and never move. Building on an empty or unrepresentative table gives centroids that do not match the real distribution, producing unbalanced lists and poor recall until the index is rebuilt.' },
    { q: 'What problem do iterative index scans solve?', a: 'Overfiltering: an ANN scan returns a fixed number of nearest candidates, and a WHERE filter applied afterwards may leave fewer rows than LIMIT. pgvector 0.8 iterative scans (hnsw.iterative_scan, ivfflat.iterative_scan) continue scanning until enough filtered rows are found, bounded by max_scan_tuples or max_probes.' },
    { q: 'When would you still pick IVFFlat over HNSW?', a: 'When the dataset is large and mostly static, rebuilt periodically, and build time or build memory is the constraint. IVFFlat builds much faster with less memory and produces a smaller index, at the cost of lower recall per millisecond and degradation under data drift.' }
  ],
  exercises: [
    { task: 'Compute the recommended lists value for 400,000 rows and for 9,000,000 rows.',
      solution: `SELECT 400000 / 1000 AS lists_for_400k,             -- rows/1000 up to 1M rows
       round(sqrt(9000000)) AS lists_for_9m;           -- sqrt(rows) above 1M`, run: true },
    { task: 'Create an IVFFlat cosine index with 20 lists on 2,000 random 4-d vectors and set probes to sqrt(lists) rounded up.',
      solution: `CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE v4 (id int, e vector(4));
INSERT INTO v4 SELECT g, ARRAY[random(),random(),random(),random()]::vector FROM generate_series(1,2000) g;
CREATE INDEX ON v4 USING ivfflat (e vector_cosine_ops) WITH (lists = 20);
SET ivfflat.probes = 5;   -- ceil(sqrt(20)) = 5
SHOW ivfflat.probes;`, run: true }
  ],
  challenge: { task: 'Show with EXPLAIN that a relaxed_order iterative HNSW scan can be wrapped in a MATERIALIZED CTE and re-sorted to guarantee exact distance order of the final rows.',
    hint: 'WITH r AS MATERIALIZED (SELECT id, embedding <-> q AS d FROM ... ORDER BY embedding <-> q LIMIT 10) SELECT * FROM r ORDER BY d + 0 - on PostgreSQL 17+ the planner otherwise assumes the CTE is already sorted and skips the Sort.',
    solution: `CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE cat2 AS
SELECT g AS id, (ARRAY['a','b','c','d','e'])[1 + g % 5] AS category,
       ARRAY[random(),random(),random(),random()]::vector(4) AS embedding
FROM generate_series(1, 3000) g;
CREATE INDEX ON cat2 USING hnsw (embedding vector_l2_ops);
ANALYZE cat2;
SET hnsw.iterative_scan = relaxed_order;
SET enable_seqscan = off;   -- tiny demo table: force the index path
EXPLAIN (COSTS OFF)
WITH r AS MATERIALIZED (
  SELECT id, embedding <-> '[0.5,0.5,0.5,0.5]' AS distance
  FROM cat2 WHERE category = 'c'
  ORDER BY embedding <-> '[0.5,0.5,0.5,0.5]'
  LIMIT 10
)
SELECT * FROM r ORDER BY distance + 0;   -- "+ 0" stops the planner from trusting the CTE order`, run: true },
  related: ['pgvector-hnsw-index', 'vector-search-filtering', 'vector-search-recall-tuning', 'vector-search'],
  quiz: [
    { type: 'mcq', q: 'Recommended starting lists for 600,000 rows?', options: ['60', '600', '775', '6000'], answer: 1, explain: 'rows/1000 for up to 1M rows -> 600.' },
    { type: 'mcq', q: 'Default value of ivfflat.probes?', options: ['1', '10', '40', 'sqrt(lists)'], answer: 0, explain: 'Default is 1, which is fast but often low recall.' },
    { type: 'tf', q: 'IVFFlat supports sparsevec and L1 distance.', answer: false, explain: 'Only HNSW supports sparsevec and the L1/Jaccard opclasses.' },
    { type: 'scenario', q: 'WHERE tenant_id = 42 ORDER BY embedding <=> $1 LIMIT 20 returns only 3 rows on pgvector 0.8. Best first step?', options: ['Increase LIMIT to 200', 'SET hnsw.iterative_scan = relaxed_order (or strict_order)', 'Drop the index', 'Use <-> instead'], answer: 1, explain: 'Iterative scans continue until enough rows pass the filter.' },
    { type: 'design', q: 'Static 40M-row image catalogue rebuilt nightly, 1-hour build window, recall target 0.9. Index?', options: ['HNSW m=64', 'IVFFlat with lists ~ sqrt(40M) and tuned probes', 'B-tree', 'No index'], answer: 1, explain: 'IVFFlat builds quickly with modest memory and suits static data rebuilt on a schedule.' }
  ]
}
]);

PGM.addLessons([
/* ------------------------------------------------------------------ */
{
  id: 'vector-search-semantic-end-to-end',
  module: 'vector-search',
  title: 'Semantic Search End-to-End on company_db Documents',
  level: 7,
  minutes: 25,
  summary: 'Add embeddings to the documents table, index them with HNSW, and answer natural-language questions with ORDER BY embedding <=> query LIMIT k.',
  objectives: [
    'Add an embedding column to an existing table and backfill it',
    'Run top-k semantic queries and convert distance to similarity',
    'Wrap search in a reusable SQL function (the pattern used by Supabase-style RPCs)',
    'Build "more like this" recommendations with a self-join',
    'Know what the application must do (embed the query) versus what PostgreSQL does',
    'Index the column with HNSW and verify the plan'
  ],
  concept: `<p>Semantic search has two halves. <strong>Offline (write path):</strong> for each document, call an embedding model and store the vector in a <code>vector(n)</code> column. <strong>Online (read path):</strong> embed the user's question with the <em>same</em> model, then ask PostgreSQL for the nearest rows: <code>ORDER BY embedding &lt;=&gt; $1 LIMIT k</code>. PostgreSQL (with the <span class="tag ext">extension</span> pgvector) never calls the model itself - the application or a pipeline does.</p>
<p><strong>Analogy - a librarian who files by topic, not title.</strong> When a book arrives, the librarian reads it and pins it on a giant topic map (embedding). When you ask a question, she places your question on the same map and hands you the books pinned closest to it. If two librarians used different maps (different models), her pins and your question's pin would not line up.</p>
<h4>Our toy model for this module</h4>
<p>Real models emit 384-3072 numbers. To keep results readable we give each of the 24 company_db <code>documents</code> a <strong>5-dimensional toy embedding</strong> whose axes mean: <code>[db internals, operations/scale, ai/search, security, store/commerce]</code>. "Understanding MVCC" is <code>[0.95,0.2,0,0,0]</code>; "Return and refund policy" is <code>[0,0,0,0.1,0.95]</code>. A question like "how do I return a damaged laptop?" would be embedded as roughly <code>[0,0.05,0,0.1,0.95]</code>. Every runnable example begins with the same setup block (add column, create the HNSW cosine index, UPDATE from VALUES) because each example runs in isolation. The index is created <em>before</em> the backfill on purpose: an index built in the same transaction right after an UPDATE of HOT-updated rows cannot be used by that transaction (<code>pg_index.indcheckxmin</code>), a subtle trap when you script migrations in one transaction.</p>
<h4>The canonical query</h4>
<ul>
<li><code>ORDER BY embedding &lt;=&gt; :q</code> - ascending distance; must match the index operator class.</li>
<li><code>LIMIT k</code> - mandatory for an ANN index to be used; typical k = 5-20 for RAG, 20-100 for re-ranking pipelines.</li>
<li><code>1 - (embedding &lt;=&gt; :q)</code> - cosine similarity for display or thresholds.</li>
<li>Return the text/metadata you need in the same query; avoid a second round-trip.</li>
</ul>`,
  why: `<p>Users phrase questions differently from how documents are written. Semantic search returns "Return and refund policy" for "can I send back broken headphones?" even with zero shared keywords. Doing it in PostgreSQL keeps search consistent with transactions (a newly inserted document is searchable the moment it commits) and lets you combine it with normal SQL - categories, permissions, dates, joins.</p>`,
  useCase: `<p>An internal knowledge base at a 3,000-employee company holds 180,000 Confluence pages split into 1.2M chunks with 768-d embeddings. A small Python service embeds each question (15 ms on a GPU), calls a SQL function <code>search_chunks(query_embedding, match_count)</code>, and gets the top 8 chunks in about 10 ms from an HNSW index. The same function is exposed via PostgREST/Supabase as an RPC endpoint, so the frontend team needed no custom backend code.</p>`,
  internals: `<p>For <code>ORDER BY embedding &lt;=&gt; $1 LIMIT 5</code> with an HNSW index, the planner chooses an Index Scan whose "Order By" clause is the distance expression: pgvector's <code>amgettuple</code> returns heap TIDs in approximate distance order, the executor fetches heap tuples (visibility check via MVCC), and <code>Limit</code> stops after 5. Without an index (or for tiny tables), the plan is Seq Scan + top-N heapsort, which computes every distance but keeps only k rows in memory - perfectly fine for thousands of rows. The query vector should be sent as a bind parameter (text <code>'[...]'</code> or binary); pgvector client libraries (pgvector-python, pgvector-node, Npgsql.Pgvector) register the type so you can pass native arrays.</p>`,
  whenNot: `<ul><li>Exact identifiers and codes (SKU-1042, error 42P01) - full-text search or B-tree lookups are precise; use hybrid search.</li>
<li>Questions that need aggregation ("how many orders last month?") - that is text-to-SQL, not retrieval.</li>
<li>Very short queries of rare words or names - embeddings may not know them; keyword search is safer.</li></ul>`,
  syntax: `-- write path (once per document, from the app/pipeline)
UPDATE documents SET embedding = $1::vector WHERE id = $2;

-- read path
SELECT id, title, 1 - (embedding <=> $1) AS similarity
FROM   documents
ORDER  BY embedding <=> $1
LIMIT  5;

-- index
CREATE INDEX ON documents USING hnsw (embedding vector_cosine_ops);`,
  examples: [
    { label: 'Basic', title: '"How do I return a damaged laptop?"',
      sql: DOCS_EMB + `
-- the app embedded the question as [0, 0.05, 0, 0.1, 0.95]
SELECT id, title,
       round((1 - (embedding <=> '[0,0.05,0,0.1,0.95]'))::numeric, 3) AS similarity
FROM   documents
ORDER  BY embedding <=> '[0,0.05,0,0.1,0.95]'
LIMIT  5;`,
      explain: `<p>The setup block adds <code>embedding vector(5)</code> to <code>documents</code> and fills it. The query vector is dominated by the "store" axis, so the store-policy documents win, followed by the laptop guide and then the e-commerce schema article (which mixes "internals" and "store"). Note the query contains neither "refund" nor "warranty", yet those documents rank first - that is semantic search.</p>`,
      output: ` id | title                          | similarity
----+--------------------------------+------------
 18 | Return and refund policy       |      0.999
 20 | Warranty claims                |      0.999
 19 | Shipping times                 |      0.993
 17 | Laptop buying guide            |      0.988
 24 | Designing an e-commerce schema |      0.702
(5 rows)`,
      run: true },
    { label: 'Intermediate', title: 'HNSW index + reusable search function',
      sql: DOCS_EMB + `
-- the setup block already created:
--   CREATE INDEX documents_embedding_hnsw ON documents USING hnsw (embedding vector_cosine_ops);

CREATE FUNCTION search_documents(query_embedding vector(5), match_count int DEFAULT 5)
RETURNS TABLE (id int, title text, category text, similarity numeric)
LANGUAGE sql STABLE AS $$
  SELECT d.id, d.title, d.category,
         round((1 - (d.embedding <=> query_embedding))::numeric, 3)
  FROM documents d
  ORDER BY d.embedding <=> query_embedding
  LIMIT match_count
$$;

-- "how do we scale PostgreSQL connections and reads?"
SELECT * FROM search_documents('[0.1,0.9,0,0.1,0]', 4);`,
      explain: `<p>The HNSW index from the setup block uses <code>vector_cosine_ops</code>, matching <code>&lt;=&gt;</code>. Wrapping the query in a <code>STABLE</code> SQL function gives the application one stable contract (and is how Supabase exposes vector search as an RPC). SQL-language functions are usually inlined, so the planner still sees the ORDER BY ... LIMIT and can use the index. The ops/scale-heavy query returns the architecture and operations articles.</p>`,
      output: ` id | title                             | category     | similarity
----+-----------------------------------+--------------+------------
  6 | Connection pooling with PgBouncer | architecture |      0.986
  5 | Scaling reads with replicas       | architecture |      0.978
 16 | Choosing a shard key              | architecture |      0.967
 11 | Backup and point in time recovery | operations   |      0.934
(4 rows)`,
      run: true },
    { label: 'Advanced', title: '"More like this": nearest documents to document 7',
      sql: DOCS_EMB + `
SELECT d.id, d.title,
       d.metadata->>'author' AS author,
       round((d.embedding <=> src.embedding)::numeric, 3) AS distance
FROM   documents src
JOIN   documents d ON d.id <> src.id
WHERE  src.id = 7                         -- "Vector search with pgvector"
ORDER  BY d.embedding <=> src.embedding
LIMIT  3;`,
      explain: `<p>Recommendations need no query text at all: use an existing row's embedding as the query vector. The self-join excludes the source row itself (distance 0). The RAG article is the obvious neighbour, then pg_trgm fuzzy matching (search-related), then JSONB. This pattern powers "related articles", "similar products" and duplicate detection.</p>`,
      output: ` id | title                          | author | distance
----+--------------------------------+--------+----------
  8 | Retrieval augmented generation | Nikhil |    0.024
 22 | Fuzzy matching with pg_trgm    | Rohan  |    0.243
  4 | Getting started with JSONB     | Vikram |    0.457
(3 rows)`,
      run: true }
  ],
  compare: {
    bad: { sql: DOCS_EMB + `
-- similarity threshold with no ORDER BY/LIMIT: scans everything, unbounded result size
SELECT id, title FROM documents
WHERE 1 - (embedding <=> '[0.2,0.1,0.9,0.1,0]') > 0.5;`, why: 'A WHERE threshold cannot use an ANN index, returns an unpredictable number of rows, and the right threshold differs per model and per query.', run: true },
    good: { sql: DOCS_EMB + `
SELECT id, title, round((1 - (embedding <=> '[0.2,0.1,0.9,0.1,0]'))::numeric, 3) AS similarity
FROM documents
ORDER BY embedding <=> '[0.2,0.1,0.9,0.1,0]'
LIMIT 3;`, why: 'Top-k with ORDER BY distance LIMIT k is index-friendly and always returns a bounded, ranked result; apply a threshold afterwards if needed.', run: true }
  },
  mistakes: [
    'Embedding documents with one model and queries with another (or forgetting a required query prefix).',
    'Omitting <code>LIMIT</code> - the index cannot be used and the whole table is sorted.',
    'Building the query vector by string concatenation in the app instead of a bind parameter (SQL injection risk and float formatting bugs).',
    'Storing embeddings for title only when users ask about body content - embed what users will search for.',
    'Forgetting to re-embed rows whose text changed (stale embeddings).'
  ],
  best: [
    'Expose search as a single SQL function or prepared statement with <code>query_embedding</code> and <code>match_count</code> parameters.',
    'Return similarity scores for logging and for tuning thresholds later.',
    'Add the HNSW index once the table has more than a few tens of thousands of rows; tiny tables are faster with exact scans.',
    'Keep an <code>embedding_model</code> column or table-level convention so re-embedding is safe.',
    'Use the "more like this" self-join pattern for recommendations instead of a second system.'
  ],
  performance: `<p>For under ~50k rows an exact scan (no index) is typically below 20-50 ms and gives perfect recall. Beyond that, HNSW keeps latency in the low milliseconds. The application-side embedding call (10-100 ms for hosted APIs) usually dominates end-to-end latency - cache embeddings of frequent queries. Return only needed columns; large <code>body</code> values are TOASTed and fetching them for 100 candidates costs I/O.</p>`,
  security: `<p>Pass the query vector as a parameter. If the search function is exposed through an API (PostgREST/Supabase RPC), make it <code>SECURITY INVOKER</code> (the default) so table GRANTs and Row Level Security still apply to the caller; a <code>SECURITY DEFINER</code> search function would bypass the caller's RLS and leak other tenants' documents.</p>`,
  scenario: { title: 'Launching semantic search on the help centre in one sprint', steps: [
    '1. CREATE EXTENSION vector; ALTER TABLE documents ADD COLUMN embedding vector(768).',
    '2. Batch-embed existing documents (e.g. 500 per API call), UPDATE in batches, commit per batch.',
    '3. Add an AFTER INSERT/UPDATE trigger or outbox row so the pipeline re-embeds changed text.',
    '4. Create search_documents(query_embedding, match_count) and an HNSW cosine index.',
    '5. Log query, top ids and similarity; review the worst 50 queries weekly and add hybrid keyword search for codes and names.'
  ] },
  widgets: ['diagram:vector-db', 'lab:vector'],
  interview: [
    { q: 'Does PostgreSQL generate embeddings?', a: 'No. Core PostgreSQL and pgvector only store and compare vectors. The application or an ingestion pipeline calls an embedding model (hosted API or local model) and writes the vectors; at query time it embeds the question and passes the vector as a parameter. Some third-party extensions (e.g. pgai) can call models from SQL, but that is an add-on.' },
    { q: 'How would you implement "related articles"?', a: 'Use the article\'s own embedding as the query vector: self-join documents, exclude the source id, ORDER BY other.embedding <=> source.embedding LIMIT k. With an HNSW index this is a millisecond query and needs no extra infrastructure.' },
    { q: 'Why wrap vector search in a SQL function?', a: 'It gives the application a stable contract, centralises the operator and limit choice, can be exposed as an RPC by PostgREST/Supabase, and LANGUAGE sql functions are usually inlined so the planner can still use the index. Keep it SECURITY INVOKER so RLS applies.' }
  ],
  exercises: [
    { task: 'Return the top 3 documents for a security-focused question embedded as [0.2,0.3,0,0.9,0], with cosine similarity.',
      solution: DOCS_EMB + `
SELECT id, title, round((1 - (embedding <=> '[0.2,0.3,0,0.9,0]'))::numeric, 3) AS similarity
FROM documents ORDER BY embedding <=> '[0.2,0.3,0,0.9,0]' LIMIT 3;`, run: true },
    { task: 'For every document in category "ai", list its single most similar document from a different category.',
      solution: DOCS_EMB + `
SELECT a.title, nn.title AS most_similar_other_category, nn.category
FROM documents a
CROSS JOIN LATERAL (
  SELECT d.title, d.category FROM documents d
  WHERE d.category <> a.category
  ORDER BY d.embedding <=> a.embedding LIMIT 1
) nn
WHERE a.category = 'ai';`, run: true }
  ],
  challenge: { task: 'Build a function similar_documents(doc_id int, k int) that returns the k nearest documents to a given document (excluding itself) with similarity, and call it for document 2 (MVCC).',
    hint: 'LANGUAGE sql STABLE; use a scalar subquery to fetch the source embedding.',
    solution: DOCS_EMB + `
CREATE FUNCTION similar_documents(doc_id int, k int DEFAULT 3)
RETURNS TABLE (id int, title text, similarity numeric)
LANGUAGE sql STABLE AS $$
  SELECT d.id, d.title,
         round((1 - (d.embedding <=> (SELECT s.embedding FROM documents s WHERE s.id = doc_id)))::numeric, 3)
  FROM documents d
  WHERE d.id <> doc_id
  ORDER BY d.embedding <=> (SELECT s.embedding FROM documents s WHERE s.id = doc_id)
  LIMIT k
$$;
SELECT * FROM similar_documents(2, 3);`, run: true },
  related: ['pgvector-embeddings-basics', 'vector-search-filtering', 'ai-rag-architecture', 'full-text-search'],
  quiz: [
    { type: 'mcq', q: 'Who computes the query embedding in a typical pgvector setup?', options: ['PostgreSQL core', 'pgvector', 'The application / embedding service', 'The HNSW index'], answer: 2, explain: 'pgvector stores and compares vectors; the application calls the model.' },
    { type: 'predict', q: 'With the toy embeddings, which document ranks first?', code: `SELECT title FROM documents ORDER BY embedding <=> '[0.3,0.2,0,0.9,0]' LIMIT 1;`, options: ['Row level security for SaaS', 'Understanding MVCC', 'Warranty claims', 'Vector search with pgvector'], answer: 0, explain: 'Document 10 has exactly [0.3,0.2,0,0.9,0] - distance 0.' },
    { type: 'bug', q: 'Why is the HNSW index never used?', code: `SELECT id FROM documents ORDER BY embedding <=> $1;`, options: ['Missing LIMIT', 'Wrong operator', 'Needs ANALYZE', 'Function is VOLATILE'], answer: 0, explain: 'ANN index scans are chosen for ORDER BY distance LIMIT k.' },
    { type: 'tf', q: 'A newly committed document is searchable by vector search immediately, without an index rebuild.', answer: true, explain: 'HNSW indexes are maintained on INSERT; the row is visible as soon as the transaction commits.' }
  ]
},
/* ------------------------------------------------------------------ */
{
  id: 'vector-search-filtering',
  module: 'vector-search',
  title: 'Metadata Filtering with Vector Search: Pre- vs Post-Filtering',
  level: 7,
  minutes: 24,
  summary: 'Combine WHERE filters with ORDER BY distance, understand overfiltering, and fix it with iterative scans, partial indexes, partitioning or exact pre-filtering.',
  objectives: [
    'Write filtered vector queries on category, JSONB metadata and tenant columns',
    'Explain post-filtering (index first, filter later) and why results come back short',
    'Explain pre-filtering (filter first, exact distance on the subset) and when it is faster',
    'Use partial HNSW indexes for a small number of hot filter values',
    'Use pgvector 0.8 iterative scans as the general fix',
    'Choose a strategy based on filter selectivity'
  ],
  concept: `<p>Real queries almost always filter: "similar products <em>in stock</em>", "chunks <em>from tenant 42</em>", "articles <em>in the security category</em>". SQL makes this trivial to write - <code>WHERE category = 'policy' ORDER BY embedding &lt;=&gt; q LIMIT 5</code> - but ANN indexes make it subtle to execute.</p>
<p><strong>Analogy - a speed-dating event with a filter.</strong> The organiser (HNSW) quickly lines up the 40 people most compatible with you, then the bouncer (WHERE) removes everyone not from your city. If only 10% are from your city, you meet 4 people instead of 10. That is <em>post-filtering</em>. <em>Pre-filtering</em> means first gathering only people from your city, then ranking all of them by compatibility - exact, and fast if your city is small, slow if it is huge.</p>
<h4>Strategies</h4>
<table>
<tr><th>Strategy</th><th>How</th><th>Best when</th><th>Risk</th></tr>
<tr><td>Post-filter (default)</td><td>ANN index scan, then WHERE</td><td>Filter keeps most rows (&gt; ~20-50%)</td><td>Short results (overfiltering)</td></tr>
<tr><td>Iterative scan (pgvector 0.8+)</td><td><code>SET hnsw.iterative_scan = strict_order|relaxed_order</code></td><td>General fix for medium selectivity</td><td>Very selective filters may scan up to <code>hnsw.max_scan_tuples</code></td></tr>
<tr><td>Pre-filter / exact</td><td>B-tree on filter column, exact distance on the subset</td><td>Filter keeps few rows (&lt; ~10-50k)</td><td>Slow if the subset is large</td></tr>
<tr><td>Partial index</td><td><code>CREATE INDEX ... WHERE category = 'policy'</code></td><td>Few, fixed, hot filter values</td><td>One index per value; must match the WHERE exactly</td></tr>
<tr><td>Partitioning</td><td>LIST/HASH partition by tenant or category; one HNSW per partition</td><td>Many tenants, filter always present</td><td>More indexes to maintain</td></tr>
</table>
<p>The PostgreSQL planner decides between "vector index then filter" and "B-tree filter then sort" using statistics. For tiny subsets it often picks the B-tree + exact sort automatically - check with <code>EXPLAIN</code>.</p>`,
  why: `<p>Filtering is where many vector-search systems silently fail: they return 3 results instead of 10, or worse, results from the wrong tenant when filtering is done in the application. PostgreSQL's advantage over standalone vector stores is that filters are ordinary SQL over relational data, enforced in the same transaction - but you must choose an execution strategy that matches filter selectivity.</p>`,
  useCase: `<p>A marketplace with 8M listings searches "similar items" filtered by <code>country</code> (15 countries, very skewed) and <code>status = 'active'</code> (70% of rows). Global HNSW + iterative scan handles large countries; for the 5 smallest countries (&lt; 20k listings each) the planner uses the B-tree on <code>(country, status)</code> and exact distance - 4 ms with perfect recall. A partial HNSW index <code>WHERE status = 'active'</code> keeps inactive listings out of the graph entirely.</p>`,
  internals: `<p>An ANN index scan has no idea about other predicates: pgvector returns candidates in approximate distance order, the executor applies the <code>Filter:</code> line, and the <code>Limit</code> node asks for more rows. Without iterative scan, HNSW's candidate queue holds only <code>ef_search</code> entries, so the scan ends after that many tuples. With iterative scan, pgvector resumes the graph search from where it stopped, emitting further candidates until the Limit is satisfied or <code>hnsw.max_scan_tuples</code> (default 20,000) is reached. In <code>EXPLAIN</code> the filter appears as <code>Filter: (category = ...)</code> under the Index Scan - that line is your signal that post-filtering is happening.</p>`,
  whenNot: `<ul><li>Do not filter in the application after fetching top-k from the database - you get short results and may leak data.</li>
<li>Do not create a partial index per tenant for thousands of tenants - use partitioning or a shared index with iterative scans.</li>
<li>Do not use a vector index at all when filters always reduce rows to a few thousand - exact distance on the subset is faster and exact.</li></ul>`,
  syntax: `-- post-filter (index on embedding, filter applied after)
SELECT ... FROM t WHERE category = $2 ORDER BY embedding <=> $1 LIMIT 10;

-- fix 1: iterative scan (pgvector 0.8+)
SET hnsw.iterative_scan = strict_order;    -- or relaxed_order
SET hnsw.max_scan_tuples = 20000;

-- fix 2: partial index for a hot filter value
CREATE INDEX ON t USING hnsw (embedding vector_cosine_ops) WHERE category = 'policy';

-- fix 3: exact pre-filter via B-tree
CREATE INDEX ON t (tenant_id);
SELECT ... FROM t WHERE tenant_id = $2 ORDER BY embedding <=> $1 LIMIT 10;  -- planner may sort the subset`,
  examples: [
    { label: 'Basic', title: 'Filter on category and JSONB metadata',
      sql: DOCS_EMB + `
-- "advanced articles about running PostgreSQL in production"
SELECT id, title, category,
       metadata->>'level' AS level,
       round((embedding <=> '[0.7,0.5,0.1,0,0]')::numeric, 3) AS distance
FROM   documents
WHERE  metadata->>'level' = 'advanced'
  AND  category IN ('database', 'operations')
ORDER  BY embedding <=> '[0.7,0.5,0.1,0,0]'
LIMIT  4;`,
      explain: `<p>Ordinary predicates - a JSONB field and an <code>IN</code> list - restrict the candidate set, and vector distance ranks what is left. On 24 rows PostgreSQL simply scans, filters and sorts, which is exact. The same SQL works unchanged on millions of rows; only the execution strategy (and the need for iterative scans or extra indexes) changes.</p>`,
      output: ` id | title                         | category   | level    | distance
----+-------------------------------+------------+----------+----------
 15 | Tuning autovacuum             | operations | advanced |    0.009
  3 | Write-Ahead Logging explained | database   | advanced |    0.032
  9 | Partitioning large tables     | database   | advanced |    0.036
  2 | Understanding MVCC            | database   | advanced |    0.090
(4 rows)`,
      run: true },
    { label: 'Intermediate', title: 'Partial HNSW index for a hot filter value',
      sql: DOCS_EMB + `
CREATE INDEX documents_emb_policy ON documents
  USING hnsw (embedding vector_cosine_ops)
  WHERE category = 'policy';

SET enable_seqscan = off;   -- the demo table is tiny; force index consideration
EXPLAIN (COSTS OFF)
SELECT id, title FROM documents
WHERE  category = 'policy'
ORDER  BY embedding <=> '[0,0.1,0,0.2,0.9]'
LIMIT  3;

SELECT id, title FROM documents
WHERE  category = 'policy'
ORDER  BY embedding <=> '[0,0.1,0,0.2,0.9]'
LIMIT  3;`,
      explain: `<p>A partial index contains only rows matching its <code>WHERE</code>, so every candidate it returns already satisfies the filter - no overfiltering and a smaller graph. The plan shows <code>Index Scan using documents_emb_policy</code> with no separate <code>Filter</code> line: the predicate is implied by the index. The query's WHERE must match (or imply) the index predicate exactly. Good for a handful of hot values (e.g. <code>status = 'active'</code>, a few languages), not for thousands of tenants.</p>`,
      output: `Limit
  ->  Index Scan using documents_emb_policy on documents
        Order By: (embedding <=> '[0,0.1,0,0.2,0.9]'::vector)

 id | title
----+--------------------------
 20 | Warranty claims
 18 | Return and refund policy
 19 | Shipping times
(3 rows)`,
      run: true },
    { label: 'Advanced', title: 'Overfiltering vs iterative scan vs exact pre-filter',
      sql: `CREATE EXTENSION IF NOT EXISTS vector;
SELECT setseed(0.1);
CREATE TABLE listings AS
SELECT g AS id,
       (ARRAY['IN','US','UK','DE','SG','AE','FR','JP','BR','CA'])[1 + g % 10] AS country,
       (SELECT array_agg(random()::real) FROM generate_series(1, 8) WHERE g > 0)::vector(8) AS embedding
FROM generate_series(1, 5000) g;
CREATE INDEX listings_hnsw ON listings USING hnsw (embedding vector_l2_ops);
CREATE INDEX listings_country ON listings (country);
ANALYZE listings;
SET hnsw.ef_search = 20;

-- 1) post-filter, no iterative scan: short result
SELECT 'post-filter' AS strategy, count(*) AS rows_returned FROM (
  SELECT id FROM listings WHERE country = 'SG'
  ORDER BY embedding <-> '[0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5]' LIMIT 10) s
UNION ALL
-- 2) exact pre-filter: MATERIALIZED CTE forces "filter first, then sort"
SELECT 'exact pre-filter', count(*) FROM (
  WITH sg AS MATERIALIZED (SELECT id, embedding FROM listings WHERE country = 'SG')
  SELECT id FROM sg ORDER BY embedding <-> '[0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5]' LIMIT 10) s;

-- 3) iterative scan (pgvector 0.8+)
SET hnsw.iterative_scan = strict_order;
SELECT 'iterative scan' AS strategy, count(*) AS rows_returned FROM (
  SELECT id FROM listings WHERE country = 'SG'
  ORDER BY embedding <-> '[0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5]' LIMIT 10) s;`,
      explain: `<p>Each country holds 10% of rows. (1) Post-filtering with <code>ef_search = 20</code> returns only the SG rows among ~20 global candidates - usually far fewer than 10. (2) The <code>MATERIALIZED</code> CTE acts as an optimisation fence: PostgreSQL fetches all 500 SG rows (via the B-tree or a scan) and computes exact distances - perfect recall, cost proportional to the subset size. (3) The iterative scan keeps walking the graph until 10 SG rows are found. Use exact pre-filtering for small subsets, iterative scans for medium/large ones.</p>`,
      output: ` strategy         | rows_returned
------------------+---------------
 post-filter      |             3
 exact pre-filter |            10
(2 rows)

 strategy       | rows_returned
----------------+---------------
 iterative scan |            10
(1 row)   -- the post-filter count varies with the random data (typically 1-4)`,
      run: true }
  ],
  compare: {
    bad: { sql: DOCS_EMB + `
-- fetch global top-3, then "filter" in the application layer
SELECT id, title, category FROM documents
ORDER BY embedding <=> '[0.3,0.3,0.2,0.4,0]' LIMIT 3;
-- app then drops rows where category <> 'security' -> maybe 0-1 rows left`, why: 'Filtering after LIMIT in the application returns short or empty results and, for tenant filters, risks leaking data the user must not see.', run: true },
    good: { sql: DOCS_EMB + `
SELECT id, title, category FROM documents
WHERE category = 'security'
ORDER BY embedding <=> '[0.3,0.3,0.2,0.4,0]' LIMIT 3;`, why: 'The filter is part of the SQL, so PostgreSQL ranks only eligible rows and returns as many as exist (up to LIMIT).', run: true }
  },
  mistakes: [
    'Filtering results in the application after <code>LIMIT k</code> - short results and possible data leaks.',
    'Not noticing the <code>Filter:</code> line under an HNSW Index Scan in EXPLAIN - the classic overfiltering signature.',
    'Raising <code>LIMIT</code> to 1000 "to have enough after filtering" - without iterative scan the HNSW scan still stops at ef_search candidates.',
    'Creating thousands of partial indexes (one per tenant) - planning overhead and maintenance explode; use partitioning.',
    'Using a partial index but writing a WHERE clause that does not exactly imply the index predicate.'
  ],
  best: [
    'Put every filter in SQL; never post-filter in the app.',
    'On pgvector 0.8+, enable <code>hnsw.iterative_scan</code> (or <code>ivfflat.iterative_scan</code>) for filtered queries by default.',
    'Add B-tree indexes on common filter columns so the planner can choose exact pre-filtering for selective filters.',
    'Partition by tenant or another always-present filter when there are many tenants and each needs isolation.',
    'Test filtered queries for result count as well as relevance.'
  ],
  performance: `<p>Selectivity drives cost. Post-filter cost ~ candidates scanned / selectivity: a 1% filter needs ~100x more candidates for the same result count, so iterative scans can approach <code>max_scan_tuples</code>; at that point exact pre-filtering (B-tree + sort of a small subset) is cheaper. Rough guide: subset under ~10-50k rows -&gt; exact; larger -&gt; HNSW with iterative scan; always-present high-cardinality filter (tenant) -&gt; partitioning. Check <code>EXPLAIN (ANALYZE, BUFFERS)</code> for rows removed by filter.</p>`,
  security: `<p>Tenant and permission filters must be enforced by the database (WHERE generated by trusted code, or better, Row Level Security). RLS predicates are applied like filters after the index scan, so they can cause overfiltering too - enable iterative scans, and index <code>tenant_id</code>.</p>`,
  scenario: { title: '"Similar items" returns 2 results for small countries', steps: [
    '1. EXPLAIN the query: Index Scan using the HNSW index with Filter: (country = ...) confirms post-filtering.',
    '2. Count rows per country: small countries have under 1% of rows.',
    '3. SET hnsw.iterative_scan = relaxed_order; verify result counts recover; check latency.',
    '4. Add a B-tree on (country) and confirm the planner switches to exact sorting for tiny countries.',
    '5. If tenants/countries are numerous and always filtered, consider LIST partitioning with per-partition HNSW indexes.'
  ] },
  widgets: ['lab:vector'],
  interview: [
    { q: 'What is overfiltering in vector search?', a: 'An ANN index returns a fixed number of nearest candidates without considering WHERE predicates; the executor filters afterwards, so selective filters leave fewer rows than LIMIT. In pgvector it is bounded by hnsw.ef_search or ivfflat.probes unless iterative scans are enabled.' },
    { q: 'Pre-filtering vs post-filtering - when is each better?', a: 'Pre-filtering (filter first via B-tree, then exact distance) is best when the filtered subset is small, giving perfect recall cheaply. Post-filtering via the ANN index is best when the filter keeps a large share of rows. pgvector 0.8 iterative scans extend post-filtering to medium selectivity.' },
    { q: 'How do partial vector indexes help, and when do they not scale?', a: 'A partial HNSW index contains only rows matching a fixed predicate, so its candidates never fail that filter. It works for a few hot values such as status or language, but one index per tenant across thousands of tenants is unmanageable; use partitioning instead.' }
  ],
  exercises: [
    { task: 'Find the 3 nearest beginner-level documents to the query [0,0,0,0.1,0.95].',
      solution: DOCS_EMB + `
SELECT id, title FROM documents
WHERE metadata->>'level' = 'beginner'
ORDER BY embedding <=> '[0,0,0,0.1,0.95]' LIMIT 3;`, run: true },
    { task: 'Return the 2 nearest documents per category for the query [0.5,0.5,0.2,0.2,0.2] using a window function.',
      solution: DOCS_EMB + `
SELECT category, id, title FROM (
  SELECT category, id, title,
         row_number() OVER (PARTITION BY category ORDER BY embedding <=> '[0.5,0.5,0.2,0.2,0.2]') AS rn
  FROM documents
) r
WHERE rn <= 2
ORDER BY category, rn;`, run: true }
  ],
  challenge: { task: 'Create a LIST-partitioned table chunks(tenant_id int, id int, embedding vector(3)) with partitions for tenants 1 and 2, an HNSW index on the parent (cascades to partitions), insert data, and show with EXPLAIN that a tenant-filtered vector query touches only one partition.',
    hint: 'PARTITION BY LIST (tenant_id); CREATE INDEX ON chunks USING hnsw (...) creates per-partition indexes; partition pruning removes the other partition.',
    solution: `CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE chunks (tenant_id int NOT NULL, id int NOT NULL, embedding vector(3)) PARTITION BY LIST (tenant_id);
CREATE TABLE chunks_t1 PARTITION OF chunks FOR VALUES IN (1);
CREATE TABLE chunks_t2 PARTITION OF chunks FOR VALUES IN (2);
CREATE INDEX ON chunks USING hnsw (embedding vector_cosine_ops);
INSERT INTO chunks SELECT 1 + g % 2, g, ARRAY[random(), random(), random()]::vector FROM generate_series(1, 2000) g;
ANALYZE chunks;
SET enable_seqscan = off;
EXPLAIN (COSTS OFF)
SELECT id FROM chunks WHERE tenant_id = 2 ORDER BY embedding <=> '[1,0,0]' LIMIT 5;`, run: true },
  related: ['pgvector-ivfflat-index', 'vector-search-recall-tuning', 'row-level-security', 'partitioning'],
  quiz: [
    { type: 'mcq', q: 'An EXPLAIN shows "Index Scan using items_hnsw ... Filter: (tenant_id = 7)". What does that mean?', options: ['Pre-filtering', 'Post-filtering: candidates are filtered after the ANN scan', 'The filter used a B-tree', 'RLS is disabled'], answer: 1, explain: 'A Filter line under the vector index scan means rows are removed after being produced by the index.' },
    { type: 'tf', q: 'Without iterative scans, increasing LIMIT from 10 to 500 guarantees 500 filtered rows from an HNSW scan.', answer: false, explain: 'The scan stops after about ef_search candidates; LIMIT cannot be satisfied.' },
    { type: 'design', q: '3,000 tenants, every query filters by tenant_id, tenants range 1k-2M rows. Best layout?', options: ['One partial index per tenant', 'Global HNSW with no filter support', 'Partition by tenant (hash or list) with per-partition HNSW + iterative scans', 'Separate databases per tenant'], answer: 2, explain: 'Partitioning keeps graphs smaller and prunes partitions; iterative scans handle remaining filters.' },
    { type: 'scenario', q: 'Filter keeps 0.2% of 10M rows (20k rows). Fastest exact approach?', options: ['HNSW + iterative scan', 'B-tree on the filter column and exact distance sort of the subset', 'IVFFlat probes=1', 'Increase ef_search to 1000'], answer: 1, explain: 'Sorting 20k distances is cheap and exact; graph walks would scan many non-matching rows.' }
  ]
},
/* ------------------------------------------------------------------ */
{
  id: 'vector-search-recall-tuning',
  module: 'vector-search',
  title: 'Tuning & Evaluating Recall: Exact vs Approximate, Quantization, Re-ranking',
  level: 7,
  minutes: 26,
  summary: 'Measure recall@k against brute force, tune ef_search/probes, and shrink indexes with halfvec and binary quantization plus exact re-ranking.',
  objectives: [
    'Compute exact (ground-truth) neighbours by disabling index scans',
    'Measure recall@k for a set of queries in pure SQL',
    'Tune ef_search / probes against a latency budget',
    'Use halfvec expression indexes to halve memory',
    'Use binary quantization with a re-ranking step',
    'Explain why candidate counts must respect ef_search'
  ],
  concept: `<p>"Approximate" nearest neighbour means the index may miss true neighbours. <strong>Recall@k</strong> = (number of true top-k rows returned) / k, averaged over a representative set of queries. If exact search returns ids {1,2,3,4,5} and the index returns {1,2,3,5,9}, recall@5 = 4/5 = 0.8.</p>
<p><strong>Analogy - a fishing net.</strong> Exact search drains the lake and counts every fish (slow, perfect). The ANN index casts a net: a wider net (higher <code>ef_search</code>/<code>probes</code>) catches more of the fish you wanted but takes longer to haul in. Quantization is using a cheaper, lighter net (smaller memory) - you then hand-check the catch (re-ranking) to throw back the wrong fish.</p>
<h4>Getting ground truth in PostgreSQL</h4>
<ul>
<li><code>SET enable_indexscan = off</code> (and <code>enable_bitmapscan</code>) forces a sequential scan + sort for the same SQL - exact results.</li>
<li>Alternatively compute the exact distance in a subquery that cannot use the index (e.g. <code>ORDER BY (embedding &lt;=&gt; q) + 0</code>).</li>
<li>Store ground truth in a table once per evaluation run; compare each configuration against it.</li>
</ul>
<h4>Quantization</h4>
<table>
<tr><th>Form</th><th>Bytes for 1536-d</th><th>Index support</th><th>Typical use</th></tr>
<tr><td><code>vector</code> (float32)</td><td>6,152</td><td>&lt;= 2000 dims</td><td>Baseline</td></tr>
<tr><td><code>halfvec</code> (float16)</td><td>3,080</td><td>&lt;= 4000 dims</td><td>Near-lossless, half the memory</td></tr>
<tr><td><code>binary_quantize()::bit</code></td><td>200</td><td>&lt;= 64000 dims</td><td>Fast candidate generation, then re-rank</td></tr>
</table>
<p><strong>Binary quantization</strong> keeps only the sign of each dimension (<code>binary_quantize</code> maps &gt; 0 to 1, else 0) and compares codes with Hamming distance <code>&lt;~&gt;</code>. It works well for high-dimensional embeddings whose components are centred around zero (most modern text models), poorly for low-dimensional or all-positive vectors. Always <strong>re-rank</strong>: fetch the top N (e.g. 4-10 x k) by Hamming, then order those by exact cosine distance.</p>`,
  why: `<p>Without measurement, tuning is guesswork: teams either over-provision (ef_search 400 everywhere, wasting CPU) or ship poor quality without knowing. Quantization is the main lever for cost at scale: an index that fits in RAM is 10-100x faster than one that does not.</p>`,
  useCase: `<p>A news recommender with 60M articles (1024-d) needed 250 GB of RAM for a float32 HNSW index. Switching to a halfvec expression index cut it to ~125 GB with recall@20 dropping from 0.962 to 0.959. For the "breaking news" path that needs &lt; 10 ms, they built a binary-quantized HNSW index (8 GB) and re-rank the top 200 candidates with full vectors fetched from the heap - recall@20 0.94 at 6 ms.</p>`,
  internals: `<p>Exact search reads every vector: cost = rows x distance cost, but it parallelises well (Parallel Seq Scan + Gather Merge of top-N sorts). ANN cost is dominated by random page reads in the graph, which is why the index must be cached. For quantized expression indexes, the index stores only the quantized expression; re-ranking reads the original <code>embedding</code> from the heap for the N candidates (N random heap fetches). A critical gotcha: the inner "candidates" query <code>ORDER BY bq &lt;~&gt; q LIMIT 200</code> still obeys <code>hnsw.ef_search</code> - with the default 40 you get at most 40 candidates, so raise <code>ef_search</code> to at least N (or enable iterative scan).</p>`,
  whenNot: `<ul><li>Skip quantization while the index comfortably fits in RAM - complexity without benefit.</li>
<li>Avoid binary quantization for low-dimensional (&lt; ~256-d) embeddings or non-centred values - too much information is lost (see the experiment below).</li>
<li>Do not report recall from a single query; use dozens to hundreds of realistic queries.</li></ul>`,
  syntax: `-- ground truth
SET enable_indexscan = off;  SELECT ... ORDER BY embedding <=> $1 LIMIT 10;  RESET enable_indexscan;

-- halfvec expression index
CREATE INDEX ON t USING hnsw ((embedding::halfvec(1536)) halfvec_cosine_ops);
SELECT ... ORDER BY embedding::halfvec(1536) <=> $1::halfvec(1536) LIMIT 10;

-- binary quantization + re-rank
CREATE INDEX ON t USING hnsw ((binary_quantize(embedding)::bit(1536)) bit_hamming_ops);
SET hnsw.ef_search = 200;
SELECT * FROM (
  SELECT id, embedding FROM t
  ORDER BY binary_quantize(embedding)::bit(1536) <~> binary_quantize($1)
  LIMIT 200) candidates
ORDER BY embedding <=> $1 LIMIT 10;`,
  examples: [
    { label: 'Basic', title: 'Exact vs approximate plans for the same SQL',
      sql: ITEMS_16 + `
CREATE INDEX items_hnsw ON items USING hnsw (embedding vector_l2_ops);

-- approximate (index)
EXPLAIN (COSTS OFF)
SELECT id FROM items ORDER BY embedding <-> (SELECT embedding FROM items WHERE id = 7) LIMIT 5;

-- exact (index disabled): same SQL, brute force
SET enable_indexscan = off;
EXPLAIN (COSTS OFF)
SELECT id FROM items ORDER BY embedding <-> (SELECT embedding FROM items WHERE id = 7) LIMIT 5;
RESET enable_indexscan;`,
      explain: `<p>The first plan is an HNSW index scan (approximate). With <code>enable_indexscan = off</code> the same query becomes Seq Scan + Sort (a top-N heapsort): every distance is computed and the answer is exact. This switch is how you produce ground truth without rewriting queries.</p>`,
      output: `Limit
  InitPlan 1
    ->  Seq Scan on items items_1
          Filter: (id = 7)
  ->  Index Scan using items_hnsw on items
        Order By: (embedding <-> (InitPlan 1).col1)

Limit
  InitPlan 1
    ->  Seq Scan on items items_1
          Filter: (id = 7)
  ->  Sort
        Sort Key: ((items.embedding <-> (InitPlan 1).col1))
        ->  Seq Scan on items`,
      run: true },
    { label: 'Intermediate', title: 'recall@5 over 30 queries, per ef_search value',
      sql: ITEMS_16 + `
CREATE INDEX ON items USING hnsw (embedding vector_l2_ops) WITH (m = 4, ef_construction = 8);
CREATE TEMP TABLE queries AS SELECT id AS qid, embedding AS qv FROM items WHERE id % 167 = 0;  -- 29 queries

SET enable_indexscan = off;
CREATE TEMP TABLE truth AS
SELECT qid, nn.id FROM queries
CROSS JOIN LATERAL (SELECT id FROM items ORDER BY embedding <-> qv LIMIT 5) nn;
RESET enable_indexscan;

CREATE TEMP TABLE eval (ef int, qid int, hits int);
SET hnsw.ef_search = 5;
INSERT INTO eval SELECT 5, qid, (SELECT count(*) FROM truth t WHERE t.qid = q.qid AND t.id IN
  (SELECT id FROM items ORDER BY embedding <-> q.qv LIMIT 5)) FROM queries q;
SET hnsw.ef_search = 40;
INSERT INTO eval SELECT 40, qid, (SELECT count(*) FROM truth t WHERE t.qid = q.qid AND t.id IN
  (SELECT id FROM items ORDER BY embedding <-> q.qv LIMIT 5)) FROM queries q;

SELECT ef AS ef_search,
       count(*)                       AS queries,
       round(avg(hits) / 5.0, 3)      AS mean_recall_at_5,
       min(hits)                      AS worst_query_hits
FROM eval GROUP BY ef ORDER BY ef;`,
      explain: `<p>A repeatable evaluation harness in pure SQL: a fixed query set, a ground-truth table built with index scans disabled, then one pass per setting. Report the <strong>mean</strong> recall and the <strong>worst</strong> query - averages hide the queries users complain about. We deliberately build a weak graph so the difference is visible; with defaults (m=16, ef_construction=64) recall on this data is near 1.0.</p>`,
      output: ` ef_search | queries | mean_recall_at_5 | worst_query_hits
-----------+---------+------------------+------------------
         5 |      29 |            0.448 |                0
        40 |      29 |            0.807 |                1
(2 rows)   -- example run; values vary with the random data`,
      run: true },
    { label: 'Advanced', title: 'Binary quantization: Hamming-only vs re-ranked recall',
      sql: `CREATE EXTENSION IF NOT EXISTS vector;
SELECT setseed(0.7);
-- 64-d vectors centred on zero (like real text embeddings)
CREATE TABLE emb64 AS
SELECT g AS id,
       (SELECT array_agg((random() - 0.5)::real) FROM generate_series(1, 64) WHERE g > 0)::vector(64) AS embedding
FROM generate_series(1, 4000) g;
CREATE INDEX emb64_bq ON emb64 USING hnsw ((binary_quantize(embedding)::bit(64)) bit_hamming_ops);
ANALYZE emb64;
CREATE TEMP TABLE q AS SELECT embedding AS v FROM emb64 WHERE id = 42;

SET enable_indexscan = off;
CREATE TEMP TABLE exact AS SELECT id FROM emb64, q ORDER BY embedding <=> q.v LIMIT 10;
RESET enable_indexscan;

SET hnsw.ef_search = 400;   -- must be >= the candidate count below
CREATE TEMP TABLE bq_only AS
SELECT id FROM emb64
ORDER BY binary_quantize(embedding)::bit(64) <~> binary_quantize((SELECT v FROM q)) LIMIT 10;

CREATE TEMP TABLE bq_rerank AS
SELECT id FROM (
  SELECT id, embedding FROM emb64
  ORDER BY binary_quantize(embedding)::bit(64) <~> binary_quantize((SELECT v FROM q))
  LIMIT 200) candidates
ORDER BY embedding <=> (SELECT v FROM q) LIMIT 10;

SELECT 'binary only' AS method, count(*) / 10.0 AS recall_at_10 FROM bq_only JOIN exact USING (id)
UNION ALL
SELECT 'binary top-200 + exact re-rank', count(*) / 10.0 FROM bq_rerank JOIN exact USING (id);

SELECT pg_column_size(embedding) AS full_bytes,
       pg_column_size(binary_quantize(embedding)) AS binary_bytes
FROM emb64 LIMIT 1;`,
      explain: `<p>Each 64-d vector (264 bytes) becomes an 8-byte bit code (16 bytes with header). Ranking by Hamming distance alone finds only a few true neighbours - 64 bits carry little information. Fetching 200 candidates by Hamming and re-ranking them with exact cosine distance recovers most of them. With real 1024-3072-d embeddings, binary codes carry far more signal and re-ranked recall is typically 0.9-0.99. Note <code>SET hnsw.ef_search = 400</code>: with the default 40, the candidate subquery would return only 40 rows despite <code>LIMIT 200</code>.</p>`,
      output: ` method                         | recall_at_10
--------------------------------+--------------
 binary only                    |          0.3
 binary top-200 + exact re-rank |          0.8
(2 rows)

 full_bytes | binary_bytes
------------+--------------
        264 |           16
(1 row)   -- example run; recall values vary with the data`,
      run: true }
  ],
  compare: {
    bad: { sql: `CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE rr (id int, embedding vector(64));
INSERT INTO rr SELECT g, (SELECT array_agg((random()-0.5)::real) FROM generate_series(1,64) WHERE g > 0)::vector
FROM generate_series(1,3000) g;
CREATE INDEX ON rr USING hnsw ((binary_quantize(embedding)::bit(64)) bit_hamming_ops);
ANALYZE rr;
-- default hnsw.ef_search = 40: the "200 candidates" are silently capped at 40
SELECT count(*) AS candidates_returned FROM (
  SELECT id FROM rr
  ORDER BY binary_quantize(embedding)::bit(64) <~> binary_quantize((SELECT embedding FROM rr WHERE id = 1))
  LIMIT 200) c;`, why: 'Re-ranking needs the full candidate set, but the HNSW scan returns at most ef_search (40) rows, so the re-rank step sees a fifth of the intended candidates.', run: true },
    good: { sql: `CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE rr (id int, embedding vector(64));
INSERT INTO rr SELECT g, (SELECT array_agg((random()-0.5)::real) FROM generate_series(1,64) WHERE g > 0)::vector
FROM generate_series(1,3000) g;
CREATE INDEX ON rr USING hnsw ((binary_quantize(embedding)::bit(64)) bit_hamming_ops);
ANALYZE rr;
SET hnsw.ef_search = 200;                -- or SET hnsw.iterative_scan = relaxed_order
SELECT count(*) AS candidates_returned FROM (
  SELECT id FROM rr
  ORDER BY binary_quantize(embedding)::bit(64) <~> binary_quantize((SELECT embedding FROM rr WHERE id = 1))
  LIMIT 200) c;`, why: 'With ef_search >= the candidate count (or an iterative scan) the first stage returns all 200 candidates (returns 200 instead of 40).', run: true }
  },
  mistakes: [
    'Evaluating recall on one or two hand-picked queries.',
    'Comparing ANN results against "ground truth" computed with the same index (forgot <code>enable_indexscan = off</code>).',
    'Asking for 200 re-rank candidates while <code>hnsw.ef_search</code> is 40.',
    'Binary-quantizing all-positive or low-dimensional vectors and wondering why recall collapses.',
    'Querying a halfvec expression index without the identical cast expression.'
  ],
  best: [
    'Maintain a versioned evaluation set (100-500 real queries) and a ground-truth table; re-run on every model, parameter or data change.',
    'Track mean and worst-case recall@k alongside p50/p95 latency.',
    'Try halfvec before anything else - usually free quality-wise.',
    'For binary quantization, over-fetch 4-10x k candidates and re-rank with full precision.',
    'Tune per query class: SET LOCAL ef_search higher for high-value or filtered queries.'
  ],
  performance: `<p>Recall gains flatten quickly; latency keeps growing. Plot recall vs ef_search (e.g. 20, 40, 80, 160, 320) and choose the knee. Quantization reduces memory (halfvec 2x, binary 32x), which often <em>improves</em> latency by keeping the index cached. Re-ranking costs N heap fetches - keep N modest (100-500) and ensure the heap is cached or the vectors are stored PLAIN to avoid TOAST lookups.</p>`,
  security: ``,
  scenario: { title: 'Cutting RAM cost of a 200 GB vector index in half without hurting quality', steps: [
    '1. Build an evaluation set and ground truth (exact search) for 300 real queries.',
    '2. Measure baseline recall@10 and p95 latency with the current float32 HNSW.',
    '3. Build a halfvec expression index CONCURRENTLY; switch queries to the cast expression on a canary.',
    '4. Compare recall and latency; if recall loss < 0.5%, roll out and drop the old index.',
    '5. Optionally add a binary-quantized index + re-rank for a low-latency tier.'
  ] },
  widgets: ['lab:vector'],
  interview: [
    { q: 'How do you measure recall of a pgvector index?', a: 'Pick a representative query set, compute exact top-k for each with index scans disabled (SET enable_indexscan = off) and store it, then run the same queries with the index and count overlaps. Recall@k is overlaps divided by k, averaged across queries; also track the worst queries.' },
    { q: 'What is binary quantization and why re-rank?', a: 'It reduces each dimension to one bit (positive or not) using binary_quantize and compares codes with Hamming distance, shrinking vectors 32x. It loses much information, so you fetch several times k candidates by Hamming distance and re-order them with exact float distance to restore quality.' },
    { q: 'halfvec vs binary quantization?', a: 'halfvec stores 16-bit floats: half the memory with negligible recall loss, usable directly for ranking. Binary quantization is 32x smaller and much faster but too lossy to rank alone; it is a first-stage candidate generator followed by re-ranking.' },
    { q: 'Why did my re-ranking pipeline not improve recall?', a: 'Often because the candidate query was capped by hnsw.ef_search: asking for LIMIT 200 with ef_search 40 returns about 40 rows. Raise ef_search to at least the candidate count or enable iterative scans.' }
  ],
  exercises: [
    { task: 'Compute recall@5 when exact = {1,2,3,4,5} and approximate = {1,2,3,5,9} using SQL set operations.',
      solution: `SELECT count(*) / 5.0 AS recall_at_5
FROM (SELECT unnest(ARRAY[1,2,3,4,5]) INTERSECT SELECT unnest(ARRAY[1,2,3,5,9])) s;`, run: true },
    { task: 'Create a halfvec cosine expression index on the documents embeddings and show a query plan that uses it.',
      solution: DOCS_EMB + `
CREATE INDEX documents_emb_half ON documents USING hnsw ((embedding::halfvec(5)) halfvec_cosine_ops);
SET enable_seqscan = off;
EXPLAIN (COSTS OFF)
SELECT id, title FROM documents
ORDER BY embedding::halfvec(5) <=> '[0.2,0.1,0.9,0.1,0]'::halfvec(5) LIMIT 3;`, run: true }
  ],
  challenge: { task: 'Show what binary_quantize does to an all-positive vector versus a zero-centred one, and explain why all-positive data breaks binary quantization.',
    hint: 'binary_quantize sets 1 for components > 0.',
    solution: `CREATE EXTENSION IF NOT EXISTS vector;
SELECT binary_quantize('[0.9,0.1,0.8,0.2,0.7,0.3]'::vector)   AS all_positive,   -- 111111: every vector looks identical
       binary_quantize('[0.4,-0.4,0.3,-0.3,0.2,-0.2]'::vector) AS centred;        -- 101010: sign pattern carries information`, run: true },
  related: ['pgvector-hnsw-index', 'pgvector-install-types', 'vector-search-filtering', 'ai-rag-production'],
  quiz: [
    { type: 'mcq', q: 'Exact top-5 = {1,2,3,4,5}; ANN top-5 = {1,2,6,7,8}. recall@5?', options: ['0.2', '0.4', '0.6', '0.8'], answer: 1, explain: 'Two of five true neighbours were returned.' },
    { type: 'tf', q: 'SET enable_indexscan = off is a valid way to get exact results for evaluation.', answer: true, explain: 'It forces a sequential scan + sort, computing every distance.' },
    { type: 'bug', q: 'Re-ranking 300 candidates still gives low recall. Why?', code: `SELECT * FROM (SELECT id, embedding FROM t ORDER BY binary_quantize(embedding)::bit(1024) <~> binary_quantize($1) LIMIT 300) c
ORDER BY embedding <=> $1 LIMIT 10;   -- hnsw.ef_search = 40`, options: ['Hamming is wrong', 'ef_search caps candidates at ~40', 'Needs DESC', 'bit(1024) too small'], answer: 1, explain: 'Raise ef_search to >= 300 or enable iterative scan.' },
    { type: 'mcq', q: 'Bytes of a 1536-d embedding as binary_quantize(...)::bit(1536)?', options: ['~200', '~1,536', '~3,072', '~6,144'], answer: 0, explain: '1536 bits = 192 bytes plus header.' },
    { type: 'optimize', q: 'HNSW index (float32, 1536-d) no longer fits in RAM. Least risky first step?', options: ['Binary quantization only, no re-rank', 'halfvec expression index', 'Drop the index', 'Lower m to 2'], answer: 1, explain: 'halfvec halves memory with negligible recall loss.' }
  ]
}
]);

PGM.addLessons([
/* ------------------------------------------------------------------ */
{
  id: 'ai-rag-architecture',
  module: 'ai-rag',
  title: 'RAG Architecture: PostgreSQL + pgvector as the Retrieval Layer',
  level: 7,
  minutes: 24,
  summary: 'How Retrieval-Augmented Generation flows from user question to embedding, similarity search in PostgreSQL, prompt assembly and LLM answer - and which part PostgreSQL owns.',
  objectives: [
    'Draw the RAG pipeline: User -> App -> Embedding model -> PostgreSQL/pgvector -> LLM -> Answer',
    'Separate the ingestion (offline) path from the query (online) path',
    'Assemble grounded prompt context with citations directly in SQL',
    'Log retrieval and answers for evaluation and debugging',
    'Explain why RAG reduces hallucination and keeps answers current',
    'Identify failure points: retrieval misses, context overflow, stale embeddings'
  ],
  concept: `<p><strong>Retrieval-Augmented Generation (RAG)</strong> answers questions with a Large Language Model (LLM) that is given <em>relevant excerpts from your own data</em> in the prompt. The LLM does not need to have been trained on your documents; it reads them at question time.</p>
<p><strong>Analogy - an open-book exam.</strong> A closed-book student (plain LLM) answers from memory and may confidently invent facts. In an open-book exam the student first looks up the right pages (retrieval), then writes the answer citing them (generation). PostgreSQL with pgvector is the index at the back of the book plus the bookshelf.</p>
<h4>The query (online) path</h4>
<ol>
<li><strong>User</strong> asks: "Can I return a laptop after 3 weeks?"</li>
<li><strong>Application</strong> (API service) authenticates the user and knows their tenant/permissions.</li>
<li><strong>Embedding model</strong> converts the question into a vector (same model used for documents).</li>
<li><strong>PostgreSQL + pgvector</strong> <span class="tag ext">extension</span>: <code>SELECT ... ORDER BY embedding &lt;=&gt; $1 LIMIT 5</code> with tenant/permission filters (and often keyword search too - hybrid).</li>
<li><strong>Prompt assembly</strong>: system instructions + retrieved chunks (with ids for citations) + the question.</li>
<li><strong>LLM</strong> generates an answer grounded in the chunks: "Yes - products can be returned within 30 days [doc 18]".</li>
<li><strong>Answer</strong> returned to the user; question, retrieved ids, answer and feedback logged (often in PostgreSQL too).</li>
</ol>
<h4>The ingestion (offline) path</h4>
<p>Documents -&gt; clean/extract text -&gt; split into chunks -&gt; embed each chunk -&gt; <code>INSERT</code> into a chunks table with the vector -&gt; HNSW index. Re-run for changed documents. (Next lesson.)</p>
<h4>What PostgreSQL owns</h4>
<ul>
<li>Source-of-truth documents and chunks, embeddings, metadata (tenant, ACL, language, dates).</li>
<li>Similarity search, keyword search (<code>tsvector</code>, core), filters, joins, permissions (GRANT, RLS).</li>
<li>Logs, feedback, semantic cache, evaluation datasets.</li>
</ul>
<p>It does <strong>not</strong> run the embedding model or the LLM - those are API calls from the application (or a third-party extension such as pgai, which is optional).</p>`,
  why: `<p>LLMs have a knowledge cut-off, know nothing about your private data, and hallucinate when unsure. Fine-tuning is slow, expensive and does not give citations or per-user permissions. RAG injects fresh, permission-filtered facts at query time, so updating knowledge is just an <code>INSERT</code>. Using PostgreSQL as the retrieval layer means one database for transactional data, documents, vectors and access control.</p>`,
  useCase: `<p>An insurance company builds a claims-assistant for 2,000 agents. 400k policy PDFs become 6M chunks (768-d embeddings, halfvec, HNSW) in PostgreSQL alongside the policy tables. A question like "Is water damage from a burst pipe covered for policy P-88123?" retrieves chunks filtered by <code>policy_id</code> and product version, joins the customer's actual coverage limits from relational tables, and sends both to the LLM. Retrieval takes 15 ms; LLM generation 1.5 s. Every answer stores the chunk ids so auditors can verify the source.</p>`,
  internals: `<p>Latency budget of a typical RAG request: query embedding 10-80 ms (hosted API), PostgreSQL retrieval 5-30 ms (HNSW + filters), optional re-ranker 50-200 ms, LLM generation 0.5-5 s (dominant). Token budget: an LLM context window (e.g. 128k tokens) is large, but cost and "lost in the middle" effects mean 3-10 well-chosen chunks of 200-800 tokens usually beat 50 mediocre ones. PostgreSQL can assemble the context in one round trip with <code>string_agg(... ORDER BY distance)</code>, returning a single text value plus the ids for citations.</p>`,
  whenNot: `<ul><li>Questions answered by structured data ("total sales in Q3") - use SQL/analytics or text-to-SQL, not chunk retrieval.</li>
<li>Tiny static knowledge (a 2-page FAQ) - put it directly in the system prompt.</li>
<li>Tasks requiring reasoning over an entire corpus ("summarise all 10,000 contracts") - batch/map-reduce pipelines, not top-k retrieval.</li></ul>`,
  syntax: `-- online path (application pseudo-code)
q_vec   = embed(question)                                  -- same model as ingestion
rows    = sql("SELECT id, title, body FROM chunks
               WHERE tenant_id = $2
               ORDER BY embedding <=> $1 LIMIT 5", q_vec, tenant)
prompt  = SYSTEM + format_context(rows) + "Question: " + question
answer  = llm(prompt)
sql("INSERT INTO rag_log(question, retrieved_ids, answer) VALUES ($1,$2,$3)", ...)`,
  examples: [
    { label: 'Basic', title: 'Retrieval step: top-3 chunks for a question',
      sql: DOCS_EMB + `
-- question: "Can I return a laptop after 3 weeks?"  -> embedded by the app
SELECT id, title, body,
       round((1 - (embedding <=> '[0,0.05,0,0.05,0.95]'))::numeric, 3) AS similarity
FROM   documents
ORDER  BY embedding <=> '[0,0.05,0,0.05,0.95]'
LIMIT  3;`,
      explain: `<p>This is step 4 of the pipeline. The returned rows are the "open book pages" the LLM will read. Note that the refund policy (30 days) is retrieved even though the question says "3 weeks" - semantic match. Returning <code>id</code> enables citations.</p>`,
      output: ` id | title                    | body                                                                                         | similarity
----+--------------------------+----------------------------------------------------------------------------------------------+------------
 18 | Return and refund policy | Products can be returned within 30 days. Refunds are issued to the original payment method.  |      0.997
 19 | Shipping times           | Orders ship within two business days. Delivery to metro cities takes three to five days.     |      0.997
 20 | Warranty claims          | Hardware warranty covers manufacturing defects. Keep the invoice to file a claim.            |      0.997
(3 rows)`,
      run: true },
    { label: 'Intermediate', title: 'Assemble the LLM prompt context in one SQL round trip',
      sql: DOCS_EMB + `
WITH hits AS (
  SELECT id, title, body, embedding <=> '[0,0.05,0,0.05,0.95]' AS distance
  FROM documents
  ORDER BY embedding <=> '[0,0.05,0,0.05,0.95]'
  LIMIT 3
)
SELECT array_agg(id ORDER BY distance) AS cited_ids,
       'Answer using ONLY the sources below. Cite as [doc N].' || E'\\n\\n' ||
       string_agg(format('[doc %s] %s: %s', id, title, body), E'\\n' ORDER BY distance) ||
       E'\\n\\nQuestion: Can I return a laptop after 3 weeks?' AS prompt
FROM hits;`,
      explain: `<p><code>string_agg(... ORDER BY distance)</code> concatenates the chunks in relevance order with a <code>[doc N]</code> label, and <code>array_agg</code> returns the ids for citation links. The application sends <code>prompt</code> to the LLM unchanged. Doing this in SQL saves a round trip and keeps formatting logic next to the data, though many teams prefer to format in the app.</p>`,
      output: ` cited_ids  | prompt
------------+-------------------------------------------------------------
 {18,20,19} | Answer using ONLY the sources below. Cite as [doc N].
            |
            | [doc 18] Return and refund policy: Products can be returned within 30 days. Refunds are issued to the original payment method.
            | [doc 20] Warranty claims: Hardware warranty covers manufacturing defects. Keep the invoice to file a claim.
            | [doc 19] Shipping times: Orders ship within two business days. Delivery to metro cities takes three to five days.
            |
            | Question: Can I return a laptop after 3 weeks?
(1 row)`,
      run: true },
    { label: 'Advanced', title: 'Log every RAG interaction for evaluation',
      sql: DOCS_EMB + `
CREATE TABLE rag_log (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  asked_at       timestamptz NOT NULL DEFAULT now(),
  user_id        int REFERENCES users(id),
  question       text NOT NULL,
  query_embedding vector(5),
  retrieved_ids  int[] NOT NULL,
  top_similarity numeric,
  answer         text,
  feedback       smallint CHECK (feedback IN (-1, 1))
);

INSERT INTO rag_log (user_id, question, query_embedding, retrieved_ids, top_similarity, answer, feedback)
SELECT 3, 'Can I return a laptop after 3 weeks?', '[0,0.05,0,0.05,0.95]',
       array_agg(id ORDER BY d), max(1 - d), 'Yes, within 30 days [doc 18].', 1
FROM (SELECT id, embedding <=> '[0,0.05,0,0.05,0.95]' AS d
      FROM documents ORDER BY d LIMIT 3) hits;

INSERT INTO rag_log (user_id, question, query_embedding, retrieved_ids, top_similarity, answer, feedback)
VALUES (4, 'What is the GST rate on monitors?', '[0.1,0.1,0.1,0.1,0.5]', '{24,17,19}', 0.62,
        'I could not find this in the knowledge base.', -1);

-- weak retrieval = low top similarity or negative feedback: candidates for new content
SELECT question, retrieved_ids, top_similarity, feedback
FROM rag_log
WHERE top_similarity < 0.8 OR feedback = -1
ORDER BY asked_at DESC;`,
      explain: `<p>Production RAG needs observability. Logging the question, its embedding, retrieved ids, best similarity and user feedback lets you find knowledge gaps (questions with low similarity), regressions after model changes, and build evaluation datasets. Because the log lives in PostgreSQL it can be joined with <code>users</code>, tenants and documents.</p>`,
      output: ` question                          | retrieved_ids | top_similarity | feedback
-----------------------------------+---------------+----------------+----------
 What is the GST rate on monitors? | {24,17,19}    |           0.62 |       -1
(1 row)`,
      run: true }
  ],
  compare: {
    bad: { sql: DOCS_EMB + `
-- dump many loosely related chunks into the prompt "to be safe"
SELECT string_agg(body, ' ') AS context
FROM (SELECT body FROM documents ORDER BY embedding <=> '[0,0.05,0,0.05,0.95]' LIMIT 20) s;`, why: '20 chunks (most irrelevant) cost tokens, slow the LLM and dilute the relevant passage; without ids the answer cannot cite sources.', run: true },
    good: { sql: DOCS_EMB + `
SELECT string_agg(format('[doc %s] %s', id, body), E'\\n' ORDER BY d) AS context,
       array_agg(id ORDER BY d) AS cited_ids
FROM (SELECT id, body, embedding <=> '[0,0.05,0,0.05,0.95]' AS d
      FROM documents ORDER BY d LIMIT 3) s;`, why: 'A few top chunks, ordered by relevance, labelled with ids: cheaper, more accurate and citable.', run: true }
  },
  mistakes: [
    'Using a different embedding model for questions than for documents.',
    'Stuffing the context window with dozens of chunks instead of the best few.',
    'Not passing chunk ids, so answers cannot cite sources and hallucinations go unnoticed.',
    'Filtering permissions in the prompt ("only use documents the user may see") instead of in SQL - the LLM is not a security boundary.',
    'No logging/evaluation - you cannot tell whether a bad answer came from retrieval or generation.'
  ],
  best: [
    'Keep the pipeline explicit: embed -&gt; retrieve (SQL) -&gt; assemble -&gt; generate -&gt; log.',
    'Enforce tenant and document permissions in PostgreSQL (WHERE + RLS) before anything reaches the LLM.',
    'Instruct the LLM to answer only from sources and to say "not found" otherwise; include ids for citations.',
    'Log retrieval results and feedback in a table; review low-similarity questions weekly.',
    'Combine vector and keyword search (hybrid) for names, codes and rare terms.'
  ],
  performance: `<p>Retrieval in PostgreSQL is rarely the bottleneck (5-30 ms) compared with the LLM (seconds). Optimise end-to-end: cache query embeddings and full answers for repeated questions, keep chunks small enough that k=3-8 fits the token budget, and use connection pooling for the many short retrieval queries. Watch the HNSW index size relative to RAM as the corpus grows.</p>`,
  security: `<p>Treat retrieved text as untrusted input to the LLM: documents can contain prompt-injection text ("ignore previous instructions"). Enforce access control in SQL (RLS), never rely on the model to hide data, do not include secrets in chunks, and log access for audits. Use a least-privilege database role for the retrieval service (SELECT on chunks only).</p>`,
  scenario: { title: 'The support bot answers confidently but wrongly about refunds', steps: [
    '1. Look up the question in rag_log: which chunk ids were retrieved and with what similarity?',
    '2. If the refund policy chunk was not retrieved: retrieval problem - check model consistency, chunking, add hybrid keyword search.',
    '3. If it was retrieved but ignored: generation problem - tighten the prompt, reduce irrelevant chunks, lower temperature.',
    '4. If the policy text is outdated: ingestion problem - re-embed changed documents (content hash) and add freshness metadata.',
    '5. Add the question to the evaluation set to prevent regressions.'
  ] },
  widgets: ['diagram:rag', 'diagram:vector-db'],
  interview: [
    { q: 'Walk through a RAG request end to end.', a: 'The app receives a question, authenticates the user, embeds the question with the same model as the documents, queries PostgreSQL with pgvector for the top-k chunks filtered by tenant and permissions (often hybrid with full-text), assembles a prompt with instructions, chunks and ids, calls the LLM, returns the cited answer and logs question, retrieved ids and feedback.' },
    { q: 'Why RAG instead of fine-tuning?', a: 'RAG gives the model fresh and private knowledge at query time, supports per-user permissions and citations, and updating knowledge is just inserting rows. Fine-tuning changes model behaviour or style but is costly, slow to update and cannot enforce row-level access to facts.' },
    { q: 'Where should document permissions be enforced in RAG?', a: 'In the database at retrieval time, via WHERE clauses generated by trusted code and ideally Row Level Security, so unauthorised chunks never reach the prompt. The LLM is not a security boundary and can be manipulated by prompt injection.' }
  ],
  exercises: [
    { task: 'Return the ids and titles of the top 2 documents for an AI question embedded as [0.1,0.2,0.9,0,0], plus a single context string labelled with [doc N].',
      solution: DOCS_EMB + `
SELECT array_agg(id ORDER BY d) AS ids,
       string_agg(format('[doc %s] %s', id, title), ' | ' ORDER BY d) AS context
FROM (SELECT id, title, embedding <=> '[0.1,0.2,0.9,0,0]' AS d
      FROM documents ORDER BY d LIMIT 2) s;`, run: true },
    { task: 'Write the application pseudo-code for the online RAG path (no SQL execution needed).',
      solution: `q_vec  = embedding_model.embed(question)
chunks = db.query("SELECT id, body FROM chunks WHERE tenant_id = $2 ORDER BY embedding <=> $1 LIMIT 5", q_vec, tenant_id)
prompt = system_rules + "\\n".join(f"[doc {c.id}] {c.body}" for c in chunks) + "\\nQuestion: " + question
answer = llm.generate(prompt)
db.execute("INSERT INTO rag_log(question, retrieved_ids, answer) VALUES ($1,$2,$3)", question, [c.id for c in chunks], answer)`, run: false }
  ],
  challenge: { task: 'Return, for the question vector [0.2,0.1,0.9,0.1,0], the top 3 documents AND a flag "low_confidence" that is true when the best similarity is below 0.9, so the app can answer "I do not know" instead of calling the LLM.',
    hint: 'Compute similarities in a CTE, then use max() OVER () or a separate aggregate.',
    solution: DOCS_EMB + `
WITH hits AS (
  SELECT id, title, 1 - (embedding <=> '[0.2,0.1,0.9,0.1,0]') AS sim
  FROM documents ORDER BY embedding <=> '[0.2,0.1,0.9,0.1,0]' LIMIT 3
)
SELECT id, title, round(sim::numeric, 3) AS similarity,
       max(sim) OVER () < 0.9 AS low_confidence
FROM hits ORDER BY sim DESC;`, run: true },
  related: ['ai-rag-ingestion-chunking', 'ai-rag-hybrid-search', 'vector-search-semantic-end-to-end', 'pgvector'],
  quiz: [
    { type: 'mcq', q: 'In a pgvector RAG stack, which component generates the final answer?', options: ['PostgreSQL', 'The HNSW index', 'The LLM', 'The embedding model'], answer: 2, explain: 'PostgreSQL retrieves; the LLM generates using the retrieved context.' },
    { type: 'tf', q: 'Telling the LLM "do not reveal other tenants\' data" is an adequate access control.', answer: false, explain: 'Access must be enforced in the database before data reaches the prompt; LLMs can be prompt-injected.' },
    { type: 'design', q: 'Your question is "What was total revenue in March?". Best approach?', options: ['RAG over documents', 'SQL aggregate (or text-to-SQL) over orders', 'Fine-tune the LLM', 'Increase k to 50'], answer: 1, explain: 'Structured aggregate questions need SQL, not chunk retrieval.' },
    { type: 'mcq', q: 'Which step usually dominates RAG latency?', options: ['HNSW search', 'Prompt assembly', 'LLM generation', 'Logging'], answer: 2, explain: 'Generation takes hundreds of ms to seconds; retrieval is milliseconds.' }
  ]
},
/* ------------------------------------------------------------------ */
{
  id: 'ai-rag-ingestion-chunking',
  module: 'ai-rag',
  title: 'Document Ingestion & Chunking: Schema, Overlap and Idempotent Re-embedding',
  level: 7,
  minutes: 26,
  summary: 'Design documents/chunks/embeddings tables, split text into overlapping chunks, track model versions, and re-embed only what changed.',
  objectives: [
    'Choose chunk size and overlap for a corpus and token budget',
    'Design a documents -> chunks -> embeddings schema with model/version columns',
    'Chunk text with overlap in SQL (for demos) and understand app-side chunkers',
    'Use content hashes to make ingestion idempotent',
    'Find chunks missing embeddings for a new model version',
    'Upsert with ON CONFLICT to avoid duplicates on re-runs'
  ],
  concept: `<p>Embedding a whole 40-page PDF as one vector blurs every topic into one point; embedding single sentences loses context. <strong>Chunking</strong> splits documents into passages small enough to be specific but large enough to be self-contained.</p>
<p><strong>Analogy - indexing a cookbook.</strong> Index the whole book as "food" and every search returns the whole book. Index each word and "salt" returns 900 hits with no recipe. Index each <em>recipe</em> (with a bit of the previous page in case it spills over) and searches land on useful units. Overlap is the "bit of the previous page".</p>
<h4>Chunk size and overlap</h4>
<ul>
<li>Typical: 200-800 tokens per chunk (roughly 150-600 English words), overlap 10-20% (e.g. 512 tokens, 64-token overlap).</li>
<li>Smaller chunks: precise retrieval, more rows/embeddings, risk of missing context. Larger: fewer rows, diluted embeddings, more tokens per prompt.</li>
<li>Respect structure: split on headings, paragraphs, list items before falling back to fixed windows ("recursive" chunkers). Keep tables and code blocks intact.</li>
<li>Prepend context: "Document: Refund policy &gt; Section: Laptops" to each chunk's text before embedding improves retrieval.</li>
</ul>
<h4>Schema</h4>
<table>
<tr><th>Table</th><th>Key columns</th><th>Purpose</th></tr>
<tr><td><code>kb_documents</code></td><td>id, tenant_id, source_uri UNIQUE, title, content_hash, updated_at</td><td>One row per source file/page</td></tr>
<tr><td><code>kb_chunks</code></td><td>id, document_id FK, chunk_index, content, content_hash, token_count; UNIQUE(document_id, chunk_index)</td><td>Text units</td></tr>
<tr><td><code>kb_embeddings</code></td><td>chunk_id FK, model, model_version, embedding vector(n), created_at; PK(chunk_id, model, model_version)</td><td>Vectors per model - lets two models coexist during migration</td></tr>
</table>
<p>Many teams store the vector directly on <code>kb_chunks</code> for simplicity; a separate embeddings table is better when you expect model migrations or multiple models (e.g. text and multilingual).</p>
<h4>Idempotent re-embedding</h4>
<p>Embedding calls cost money. Store <code>md5(content)</code> (or sha256 via <code>sha256(convert_to(content,'UTF8'))</code>, core since PG11) per chunk; on re-ingestion, upsert chunks and only (re)embed rows whose hash changed or that lack an embedding for the current model/version.</p>`,
  why: `<p>Ingestion quality decides RAG quality: wrong chunk boundaries or stale embeddings cannot be fixed by a better LLM. Idempotency matters because pipelines crash, re-run and receive the same documents repeatedly; without hashes and unique keys you pay to embed the same text again and accumulate duplicates that crowd the top-k results.</p>`,
  useCase: `<p>A SaaS help-desk ingests 2M articles from 9,000 customer workspaces nightly. 97% are unchanged; comparing <code>content_hash</code> reduces nightly embedding calls from 14M chunks to ~400k, cutting the embedding bill by 96%. When they switched from a 1536-d to a 1024-d model they inserted new rows into <code>kb_embeddings</code> with <code>model_version = 'v2'</code> in the background while queries kept using v1, then flipped a config flag.</p>`,
  internals: `<p>Chunk tables are append/update heavy; HNSW insert cost dominates ingestion (each insert walks the graph). For bulk backfills, load chunks and embeddings first, then build the HNSW index (or drop and rebuild it). <code>INSERT ... ON CONFLICT (document_id, chunk_index) DO UPDATE ... WHERE kb_chunks.content_hash IS DISTINCT FROM EXCLUDED.content_hash</code> skips writing unchanged rows (no new tuple version, no WAL, no index churn). Deleting a document should cascade to chunks and embeddings (<code>ON DELETE CASCADE</code>) - and VACUUM must clean the HNSW index afterwards.</p>`,
  whenNot: `<ul><li>Short, atomic records (product titles, FAQ entries, tickets under ~300 words) do not need chunking - embed each row once.</li>
<li>Do not chunk in SQL for production corpora - tokenizer-aware chunkers in the pipeline (LangChain, LlamaIndex, custom) handle tokens, headings, tables and PDFs. SQL chunking below is for learning and quick prototypes.</li></ul>`,
  syntax: `CREATE TABLE kb_chunks (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  document_id  bigint NOT NULL REFERENCES kb_documents(id) ON DELETE CASCADE,
  chunk_index  int    NOT NULL,
  content      text   NOT NULL,
  content_hash text   NOT NULL,
  UNIQUE (document_id, chunk_index)
);
CREATE TABLE kb_embeddings (
  chunk_id      bigint REFERENCES kb_chunks(id) ON DELETE CASCADE,
  model         text, model_version text,
  embedding     vector(768) NOT NULL,
  PRIMARY KEY (chunk_id, model, model_version)
);
INSERT ... ON CONFLICT (document_id, chunk_index) DO UPDATE SET ...
  WHERE kb_chunks.content_hash IS DISTINCT FROM EXCLUDED.content_hash;`,
  examples: [
    { label: 'Basic', title: 'documents / chunks / embeddings schema with model versions',
      sql: `CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE kb_documents (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id    int  NOT NULL,
  source_uri   text NOT NULL UNIQUE,
  title        text NOT NULL,
  content_hash text NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE kb_chunks (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  document_id  bigint NOT NULL REFERENCES kb_documents(id) ON DELETE CASCADE,
  chunk_index  int    NOT NULL,
  content      text   NOT NULL,
  content_hash text   NOT NULL,
  token_count  int,
  UNIQUE (document_id, chunk_index)
);
CREATE TABLE kb_embeddings (
  chunk_id      bigint NOT NULL REFERENCES kb_chunks(id) ON DELETE CASCADE,
  model         text   NOT NULL,
  model_version text   NOT NULL,
  embedding     vector(3) NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chunk_id, model, model_version)
);
CREATE INDEX kb_embeddings_hnsw ON kb_embeddings USING hnsw (embedding vector_cosine_ops);

INSERT INTO kb_documents (tenant_id, source_uri, title, content_hash)
VALUES (1, 'https://kb.example.com/refunds', 'Refund policy', md5('v1'));
INSERT INTO kb_chunks (document_id, chunk_index, content, content_hash)
VALUES (1, 0, 'Products can be returned within 30 days.', md5('Products can be returned within 30 days.')),
       (1, 1, 'Refunds go to the original payment method.', md5('Refunds go to the original payment method.'));
INSERT INTO kb_embeddings (chunk_id, model, model_version, embedding)
VALUES (1, 'toy-3d', 'v1', '[0.1,0.9,0.1]'), (2, 'toy-3d', 'v1', '[0.2,0.8,0.3]');

SELECT d.title, c.chunk_index, c.content, e.model, e.model_version
FROM kb_documents d JOIN kb_chunks c ON c.document_id = d.id
JOIN kb_embeddings e ON e.chunk_id = c.id
ORDER BY c.chunk_index;`,
      explain: `<p>Three tables separate concerns: the document (source of truth, with a unique <code>source_uri</code> for upserts), its chunks (text, position, hash) and embeddings (one row per chunk per model/version). <code>ON DELETE CASCADE</code> removes chunks and vectors when a document is deleted. Keying embeddings by <code>(chunk_id, model, model_version)</code> lets a v2 model be backfilled alongside v1. In production the vector dimension would be 384-1536, not 3.</p>`,
      output: ` title         | chunk_index | content                                    | model  | model_version
---------------+-------------+--------------------------------------------+--------+---------------
 Refund policy |           0 | Products can be returned within 30 days.   | toy-3d | v1
 Refund policy |           1 | Refunds go to the original payment method. | toy-3d | v1
(2 rows)`,
      run: true },
    { label: 'Intermediate', title: 'Chunk documents.body into 8-word windows with 3-word overlap (SQL demo)',
      sql: `SELECT d.id AS document_id,
       c.chunk_index,
       array_to_string(w.words[c.start_word : c.start_word + 7], ' ') AS chunk_text
FROM documents d
CROSS JOIN LATERAL (SELECT regexp_split_to_array(d.body, '\\s+') AS words) w
CROSS JOIN LATERAL (
  SELECT row_number() OVER () - 1 AS chunk_index, s AS start_word
  FROM generate_series(1, greatest(cardinality(w.words) - 3, 1), 5) AS s   -- step = 8 - 3 overlap
) c
WHERE d.id IN (7, 18)
ORDER BY d.id, c.chunk_index;`,
      explain: `<p>The body is split into words; <code>generate_series(1, n, 5)</code> produces window starts every 5 words, and each window takes 8 words (<code>words[s : s+7]</code>), so consecutive chunks share 3 words of overlap - notice "and HNSW or" repeated between chunk 0 and 1. Real pipelines count <em>tokens</em> with the embedding model's tokenizer and prefer paragraph/heading boundaries, but the mechanics are identical.</p>`,
      output: ` document_id | chunk_index | chunk_text
-------------+-------------+--------------------------------------------------
           7 |           0 | pgvector adds a vector type and HNSW or
           7 |           1 | and HNSW or IVFFlat indexes so you can
           7 |           2 | so you can run semantic similarity search next
           7 |           3 | similarity search next to relational data.
          18 |           0 | Products can be returned within 30 days. Refunds
          18 |           1 | 30 days. Refunds are issued to the original
          18 |           2 | to the original payment method.
(7 rows)`,
      run: true },
    { label: 'Advanced', title: 'Idempotent upsert + "what needs (re)embedding?"',
      sql: `CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE kb_chunks (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  document_id  int  NOT NULL,
  chunk_index  int  NOT NULL,
  content      text NOT NULL,
  content_hash text NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, chunk_index)
);
CREATE TABLE kb_embeddings (
  chunk_id bigint REFERENCES kb_chunks(id) ON DELETE CASCADE,
  model_version text NOT NULL,
  content_hash  text NOT NULL,          -- hash of the text that was embedded
  embedding vector(3) NOT NULL,
  PRIMARY KEY (chunk_id, model_version)
);
-- first ingestion run: chunk 0 and 1 of document 18, both embedded with v1
INSERT INTO kb_chunks (document_id, chunk_index, content, content_hash) VALUES
  (18, 0, 'Products can be returned within 30 days.', md5('Products can be returned within 30 days.')),
  (18, 1, 'Refunds are issued to the original payment method.', md5('Refunds are issued to the original payment method.'));
INSERT INTO kb_embeddings SELECT id, 'v1', content_hash, '[0.1,0.9,0.1]' FROM kb_chunks;

-- second run: chunk 0 text changed (30 -> 45 days), chunk 1 unchanged, chunk 2 new
INSERT INTO kb_chunks AS k (document_id, chunk_index, content, content_hash)
VALUES (18, 0, 'Products can be returned within 45 days.', md5('Products can be returned within 45 days.')),
       (18, 1, 'Refunds are issued to the original payment method.', md5('Refunds are issued to the original payment method.')),
       (18, 2, 'Opened software cannot be returned.', md5('Opened software cannot be returned.'))
ON CONFLICT (document_id, chunk_index) DO UPDATE
   SET content = EXCLUDED.content, content_hash = EXCLUDED.content_hash, updated_at = now()
   WHERE k.content_hash IS DISTINCT FROM EXCLUDED.content_hash;   -- skip unchanged rows

-- chunks that need embedding for model v1: missing or embedded from stale text
SELECT c.id, c.chunk_index, c.content,
       CASE WHEN e.chunk_id IS NULL THEN 'missing' ELSE 'stale' END AS reason
FROM kb_chunks c
LEFT JOIN kb_embeddings e ON e.chunk_id = c.id AND e.model_version = 'v1'
WHERE e.chunk_id IS NULL OR e.content_hash <> c.content_hash
ORDER BY c.chunk_index;`,
      explain: `<p>The upsert inserts new chunks, updates changed ones and - thanks to the <code>WHERE ... IS DISTINCT FROM</code> on <code>DO UPDATE</code> - leaves unchanged rows untouched (no new row version, no WAL). The embeddings table records which hash was embedded, so a simple anti-join finds exactly the work for the embedding worker: the changed chunk 0 ("stale") and the new chunk 2 ("missing"). Re-running the pipeline is safe and costs nothing for unchanged text. For a model migration, the same query with <code>model_version = 'v2'</code> lists everything.</p>`,
      output: ` id | chunk_index | content                                   | reason
----+-------------+-------------------------------------------+---------
  1 |           0 | Products can be returned within 45 days.  | stale
  5 |           2 | Opened software cannot be returned.       | missing
(2 rows)`,
      run: true }
  ],
  compare: {
    bad: { sql: `CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE chunks_bad (id serial PRIMARY KEY, doc text, content text, embedding vector(3));
-- every pipeline run blindly inserts again
INSERT INTO chunks_bad (doc, content, embedding) VALUES ('refunds', 'Return within 30 days.', '[0.1,0.9,0.1]');
INSERT INTO chunks_bad (doc, content, embedding) VALUES ('refunds', 'Return within 30 days.', '[0.1,0.9,0.1]');
SELECT content, count(*) AS copies FROM chunks_bad GROUP BY content;`, why: 'No natural key and no hash: re-runs duplicate chunks, double the embedding bill, and duplicates crowd out other results in top-k.', run: true },
    good: { sql: `CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE chunks_good (doc text, chunk_index int, content text, content_hash text, embedding vector(3),
                          PRIMARY KEY (doc, chunk_index));
INSERT INTO chunks_good VALUES ('refunds', 0, 'Return within 30 days.', md5('Return within 30 days.'), '[0.1,0.9,0.1]')
ON CONFLICT (doc, chunk_index) DO UPDATE SET content = EXCLUDED.content, content_hash = EXCLUDED.content_hash, embedding = NULL
WHERE chunks_good.content_hash IS DISTINCT FROM EXCLUDED.content_hash;
INSERT INTO chunks_good VALUES ('refunds', 0, 'Return within 30 days.', md5('Return within 30 days.'), '[0.1,0.9,0.1]')
ON CONFLICT (doc, chunk_index) DO UPDATE SET content = EXCLUDED.content, content_hash = EXCLUDED.content_hash, embedding = NULL
WHERE chunks_good.content_hash IS DISTINCT FROM EXCLUDED.content_hash;
SELECT content, count(*) AS copies FROM chunks_good GROUP BY content;`, why: 'A natural key (doc, chunk_index) plus a content hash makes re-runs idempotent; changed text clears the embedding so the worker re-embeds it.', run: true }
  },
  mistakes: [
    'Embedding entire long documents as one vector - retrieval becomes vague.',
    'Zero overlap with fixed windows - sentences split across chunks become unfindable.',
    'No unique key on (document, chunk_index) - re-runs create duplicates.',
    'Not recording model and version - after a model upgrade you cannot tell which vectors are comparable.',
    'Re-embedding the whole corpus nightly instead of only changed chunks.',
    'Forgetting deletions: documents removed at the source stay searchable forever.'
  ],
  best: [
    'Chunk by structure first (headings, paragraphs), then by token windows of ~200-800 tokens with 10-20% overlap.',
    'Store <code>content_hash</code> and the hash that was embedded; re-embed only on change.',
    'Key embeddings by (chunk, model, model_version) to support side-by-side migrations.',
    'Bulk-load first and build HNSW afterwards for large backfills; batch embedding API calls.',
    'Propagate deletes with ON DELETE CASCADE and sync deletions from the source system.'
  ],
  performance: `<p>Each chunk becomes a row plus an embedding (e.g. 3 KB at 768-d) plus HNSW links - 1M chunks is roughly 6-8 GB with index. Inserting into an existing HNSW index is the slowest part of ingestion; for millions of rows, drop/rebuild or build after loading with parallel workers. Skipping unchanged rows with the conditional <code>DO UPDATE</code> avoids dead tuples and index churn, keeping autovacuum load low.</p>`,
  security: `<p>Carry ACL metadata (tenant_id, visibility, owner/group ids) from the source onto every chunk at ingestion time so retrieval can filter and RLS can enforce it. Strip secrets and personal data before embedding if they are not needed - embeddings can leak information and third-party embedding APIs see the raw text.</p>`,
  scenario: { title: 'Nightly ingestion costs exploded after adding 3 new sources', steps: [
    '1. Count embedding calls per run and per source from pipeline logs.',
    '2. Check for duplicates: SELECT content_hash, count(*) FROM kb_chunks GROUP BY 1 HAVING count(*) > 1.',
    '3. Add UNIQUE (document_id, chunk_index) and an upsert with a content-hash guard.',
    '4. Add the embedded content_hash to kb_embeddings and only embed missing/stale rows.',
    '5. Verify the next run embeds only changed chunks and that the search results no longer show duplicates.'
  ] },
  widgets: ['diagram:rag'],
  interview: [
    { q: 'How do you choose chunk size and overlap?', a: 'Start around 300-600 tokens with 10-20% overlap, split on document structure first, then measure retrieval recall on real questions. Smaller chunks increase precision but lose context and increase row count; larger chunks dilute embeddings and cost more tokens per prompt.' },
    { q: 'How do you make re-embedding idempotent?', a: 'Give chunks a natural key such as (document_id, chunk_index), store a hash of the content, upsert with ON CONFLICT DO UPDATE only when the hash differs, and record which hash and model version each embedding was created from. The worker then embeds only rows that are missing or stale for the current model version.' },
    { q: 'Why store embeddings in a separate table keyed by model version?', a: 'Because model upgrades require a full re-embed and vectors from different models are incomparable. A separate table lets you backfill v2 in the background while v1 serves traffic, compare quality, and switch atomically.' }
  ],
  exercises: [
    { task: 'Split each body of the "policy" category documents into sentences (on ". ") and number them per document.',
      solution: `SELECT d.id, s.ord AS sentence_no, s.sentence
FROM documents d
CROSS JOIN LATERAL unnest(regexp_split_to_array(d.body, '\\.\\s+')) WITH ORDINALITY AS s(sentence, ord)
WHERE d.category = 'policy'
ORDER BY d.id, s.ord;`, run: true },
    { task: 'Compute an md5 content hash and word count for every document body and list the 3 longest.',
      solution: `SELECT id, title, md5(body) AS content_hash,
       cardinality(regexp_split_to_array(body, '\\s+')) AS words
FROM documents ORDER BY words DESC LIMIT 3;`, run: true }
  ],
  challenge: { task: 'Load the documents table into kb_chunks as 10-word windows with 2-word overlap, idempotently (running the INSERT twice must not create duplicates), and report the chunk count per category.',
    hint: 'Window start step = 8; UNIQUE (document_id, chunk_index); ON CONFLICT DO NOTHING; run the INSERT twice.',
    solution: `CREATE TABLE kb_chunks (
  document_id int, chunk_index int, category text, content text, content_hash text,
  PRIMARY KEY (document_id, chunk_index)
);
INSERT INTO kb_chunks
SELECT d.id, c.chunk_index, d.category,
       array_to_string(w.words[c.s : c.s + 9], ' '),
       md5(array_to_string(w.words[c.s : c.s + 9], ' '))
FROM documents d
CROSS JOIN LATERAL (SELECT regexp_split_to_array(d.body, '\\s+') AS words) w
CROSS JOIN LATERAL (SELECT row_number() OVER () - 1 AS chunk_index, s
                    FROM generate_series(1, greatest(cardinality(w.words) - 2, 1), 8) s) c
ON CONFLICT DO NOTHING;
INSERT INTO kb_chunks
SELECT d.id, c.chunk_index, d.category,
       array_to_string(w.words[c.s : c.s + 9], ' '),
       md5(array_to_string(w.words[c.s : c.s + 9], ' '))
FROM documents d
CROSS JOIN LATERAL (SELECT regexp_split_to_array(d.body, '\\s+') AS words) w
CROSS JOIN LATERAL (SELECT row_number() OVER () - 1 AS chunk_index, s
                    FROM generate_series(1, greatest(cardinality(w.words) - 2, 1), 8) s) c
ON CONFLICT DO NOTHING;
SELECT category, count(*) AS chunks FROM kb_chunks GROUP BY category ORDER BY chunks DESC;`, run: true },
  related: ['ai-rag-architecture', 'ai-rag-hybrid-search', 'pgvector-install-types', 'crud'],
  quiz: [
    { type: 'mcq', q: 'A typical starting chunk size for text RAG is...', options: ['5-10 tokens', '200-800 tokens', '10,000 tokens', 'One whole document'], answer: 1, explain: 'A few hundred tokens with 10-20% overlap is the common starting point.' },
    { type: 'tf', q: 'Overlap between chunks helps sentences that cross a chunk boundary remain retrievable.', answer: true, explain: 'Overlap duplicates boundary text in both neighbouring chunks.' },
    { type: 'design', q: 'You will migrate embedding models next quarter. Schema choice?', options: ['One embedding column, overwrite in place', 'Embeddings table keyed by (chunk_id, model, model_version)', 'Store vectors in JSONB', 'Separate database per model'], answer: 1, explain: 'Side-by-side versions allow background backfill and atomic switch.' },
    { type: 'bug', q: 'Why does every nightly run re-embed all chunks?', code: `INSERT INTO kb_chunks (...) VALUES (...)
ON CONFLICT (document_id, chunk_index) DO UPDATE SET content = EXCLUDED.content, embedding = NULL;`, options: ['Missing WHERE content_hash IS DISTINCT FROM EXCLUDED.content_hash', 'Wrong conflict target', 'Needs DO NOTHING', 'md5 is too slow'], answer: 0, explain: 'Without the hash guard, unchanged rows are updated and their embeddings cleared.' }
  ]
},
/* ------------------------------------------------------------------ */
{
  id: 'ai-rag-hybrid-search',
  module: 'ai-rag',
  title: 'Hybrid Search: Full-Text + Vector with Reciprocal Rank Fusion in SQL',
  level: 7,
  minutes: 26,
  summary: 'Combine core full-text search (tsvector, ts_rank) with pgvector similarity and merge the rankings with Reciprocal Rank Fusion - entirely in SQL on the documents table.',
  objectives: [
    'Explain what keyword search catches that embeddings miss, and vice versa',
    'Run keyword (websearch_to_tsquery + ts_rank) and vector rankings side by side',
    'Implement Reciprocal Rank Fusion (RRF) with CTEs and FULL OUTER JOIN',
    'Weight the two signals and tune the k constant',
    'Package hybrid search as a SQL function',
    'Index both sides: GIN on tsvector, HNSW on the embedding'
  ],
  concept: `<p><strong>Hybrid search</strong> runs two retrievers and merges their results: <span class="tag core">core</span> full-text search (lexical: exact words, stemming, ranking with <code>ts_rank</code>) and <span class="tag ext">extension</span> pgvector similarity (semantic: meaning). Each covers the other's blind spots.</p>
<table>
<tr><th>Query</th><th>Keyword search</th><th>Vector search</th></tr>
<tr><td>"error 42P01", "SKU-1042", "PgBouncer"</td><td>Strong - exact token</td><td>Weak - rare tokens blur</td></tr>
<tr><td>"can I send back broken earbuds"</td><td>Weak - no shared words with "refund policy"</td><td>Strong - same meaning</td></tr>
<tr><td>"HNSW index for semantic retrieval"</td><td>Finds the doc mentioning HNSW</td><td>Finds AI/RAG docs</td></tr>
</table>
<p><strong>Analogy - two witnesses.</strong> One witness remembers exact names and licence plates (keyword), the other remembers what people looked like and what they were doing (vector). A detective trusts suspects that <em>both</em> witnesses rank highly, but still considers someone only one of them saw clearly.</p>
<h4>Reciprocal Rank Fusion (RRF)</h4>
<p>Scores from <code>ts_rank</code> (0..~1, unbounded with weights) and cosine distance (0..2) are not comparable, so instead of mixing scores, RRF mixes <strong>ranks</strong>:</p>
<p><code>rrf_score(d) = sum over retrievers r of 1 / (k + rank_r(d))</code>, with <code>k = 60</code> by convention.</p>
<p>A document ranked 1st by keyword and 2nd by vector scores 1/61 + 1/62 = 0.0325; one ranked 1st by vector only scores 1/61 = 0.0164. Missing from a list contributes 0. <code>k</code> dampens the dominance of top positions: smaller k = more weight on the very top ranks. Optional weights: <code>w_kw / (k + rank_kw) + w_vec / (k + rank_vec)</code>.</p>
<h4>SQL shape</h4>
<ol>
<li>CTE <code>kw</code>: rows matching <code>search @@ query</code>, ranked with <code>row_number() OVER (ORDER BY ts_rank(...) DESC)</code>, LIMIT 20-50.</li>
<li>CTE <code>sem</code>: rows ranked by <code>embedding &lt;=&gt; :qvec</code>, LIMIT 20-50.</li>
<li><code>FULL OUTER JOIN</code> the two on id, compute RRF with <code>COALESCE(1.0/(60+rank), 0)</code>, ORDER BY score DESC LIMIT k.</li>
</ol>
<p>The company_db <code>documents</code> table already has a generated <code>search tsvector</code> column (title weight A, body weight B) and a GIN index <code>idx_documents_search</code>; we add toy embeddings to it.</p>`,
  why: `<p>Benchmarks across many domains show hybrid retrieval beats either method alone, especially for queries containing names, codes, acronyms or jargon that embedding models never saw. PostgreSQL is unusually good at hybrid search because both retrievers live in the same engine and table - no cross-system merging, consistent filtering and permissions, one round trip.</p>`,
  useCase: `<p>A developer-documentation portal (500k pages) found that 18% of queries were error codes, CLI flags or API names (<code>pg_stat_statements</code>, <code>--no-owner</code>). Vector-only search answered them poorly; keyword-only failed on natural-language questions. RRF hybrid search in a single SQL function (GIN + HNSW, top 40 from each) raised answer accuracy of their RAG bot from 71% to 84% on a 400-question evaluation set, with p95 retrieval latency of 22 ms.</p>`,
  internals: `<p>The keyword CTE uses the GIN index on <code>search</code> for <code>@@</code> (bitmap index scan), then computes <code>ts_rank</code> for matching rows only - <code>ts_rank</code> itself cannot use an index, so limit candidates. The vector CTE uses HNSW via ORDER BY ... LIMIT. Each CTE is evaluated once; the FULL OUTER JOIN on a few dozen rows is trivial. <code>websearch_to_tsquery</code> parses user input safely (quotes, OR, -exclusion) without syntax errors, unlike <code>to_tsquery</code>. Both lists must be limited <em>before</em> fusion; fusing full rankings defeats the indexes.</p>`,
  whenNot: `<ul><li>Pure identifier lookups - a B-tree or trigram index answers directly.</li>
<li>When keyword search is useless for your language/domain (e.g. no text search configuration for the language and no tokenization) - consider sparse learned vectors (<code>sparsevec</code>) instead.</li>
<li>If you add a cross-encoder re-ranker, simple union of candidates may be enough - the re-ranker decides the final order.</li></ul>`,
  syntax: `WITH q AS (SELECT websearch_to_tsquery('english', $1) AS tsq, $2::vector AS qvec),
kw AS (
  SELECT d.id, row_number() OVER (ORDER BY ts_rank(d.search, q.tsq) DESC) AS rnk
  FROM documents d, q WHERE d.search @@ q.tsq
  ORDER BY rnk LIMIT 40),
sem AS (
  SELECT d.id, row_number() OVER (ORDER BY d.embedding <=> q.qvec) AS rnk
  FROM documents d, q
  ORDER BY d.embedding <=> q.qvec LIMIT 40)
SELECT id,
       COALESCE(1.0 / (60 + kw.rnk), 0) + COALESCE(1.0 / (60 + sem.rnk), 0) AS rrf
FROM kw FULL OUTER JOIN sem USING (id)
ORDER BY rrf DESC LIMIT 10;`,
  examples: [
    { label: 'Basic', title: 'Keyword vs vector, side by side',
      sql: DOCS_EMB + `
-- keyword retriever (core full-text search on the generated search column)
SELECT 'keyword' AS retriever, id, title,
       round(ts_rank(search, websearch_to_tsquery('english', 'HNSW semantic retrieval'))::numeric, 4) AS score
FROM documents
WHERE search @@ websearch_to_tsquery('english', 'HNSW semantic retrieval')
UNION ALL
-- vector retriever (pgvector); question embedded as [0.2,0.1,0.9,0.1,0]
SELECT 'vector', id, title, round((1 - (embedding <=> '[0.2,0.1,0.9,0.1,0]'))::numeric, 4)
FROM (SELECT * FROM documents ORDER BY embedding <=> '[0.2,0.1,0.9,0.1,0]' LIMIT 3) v
ORDER BY retriever, score DESC;`,
      explain: `<p><code>websearch_to_tsquery</code> turns "HNSW semantic retrieval" into <code>'hnsw' &amp; 'semant' &amp; 'retriev'</code> (all words required by default). No document contains all three stems, so keyword search returns nothing - a classic lexical miss. The vector retriever still finds the AI documents. Change the text to just 'HNSW' and keyword search finds document 7 precisely. Each retriever fails differently - the motivation for fusing them.</p>`,
      output: ` retriever | id | title                          | score
-----------+----+--------------------------------+--------
 vector    |  8 | Retrieval augmented generation | 0.9890
 vector    |  7 | Vector search with pgvector    | 0.9865
 vector    | 22 | Fuzzy matching with pg_trgm    | 0.7069
(3 rows)   -- keyword rows: none (no document contains all three terms)`,
      run: true },
    { label: 'Intermediate', title: 'Reciprocal Rank Fusion in pure SQL',
      sql: DOCS_EMB + `
WITH q AS (
  SELECT websearch_to_tsquery('english', 'vector OR HNSW OR retrieval') AS tsq,
         '[0.2,0.1,0.9,0.1,0]'::vector AS qvec
),
kw AS (
  SELECT d.id, row_number() OVER (ORDER BY ts_rank(d.search, q.tsq) DESC) AS rnk
  FROM documents d, q
  WHERE d.search @@ q.tsq
  ORDER BY rnk LIMIT 20
),
sem AS (
  SELECT d.id, row_number() OVER (ORDER BY d.embedding <=> q.qvec) AS rnk
  FROM documents d, q
  ORDER BY d.embedding <=> q.qvec LIMIT 20
)
SELECT d.id, d.title,
       kw.rnk  AS keyword_rank,
       sem.rnk AS vector_rank,
       round(COALESCE(1.0 / (60 + kw.rnk), 0) + COALESCE(1.0 / (60 + sem.rnk), 0), 5) AS rrf_score
FROM kw
FULL OUTER JOIN sem USING (id)
JOIN documents d USING (id)
ORDER BY rrf_score DESC
LIMIT 5;`,
      explain: `<p>Two CTEs rank candidates independently with <code>row_number()</code>; <code>FULL OUTER JOIN ... USING (id)</code> keeps documents found by either retriever; <code>COALESCE(..., 0)</code> gives zero credit when a retriever did not return the document. Documents found by both (here "Vector search with pgvector" and "Retrieval augmented generation", which match the OR query and are semantically close) rise to the top. Each list is limited to 20 before fusion so both sides can use their indexes.</p>`,
      output: ` id | title                          | keyword_rank | vector_rank | rrf_score
----+--------------------------------+--------------+-------------+-----------
  8 | Retrieval augmented generation |            2 |           1 |   0.03252
  7 | Vector search with pgvector    |            1 |           2 |   0.03252
 22 | Fuzzy matching with pg_trgm    |              |           3 |   0.01587
  4 | Getting started with JSONB     |              |           4 |   0.01563
 13 | Window functions for reporting |              |           5 |   0.01538
(5 rows)`,
      run: true },
    { label: 'Advanced', title: 'Weighted hybrid_search() function',
      sql: DOCS_EMB + `
CREATE FUNCTION hybrid_search(
  query_text      text,
  query_embedding vector(5),
  match_count     int     DEFAULT 5,
  keyword_weight  numeric DEFAULT 1.0,
  vector_weight   numeric DEFAULT 1.0,
  rrf_k           int     DEFAULT 60
)
RETURNS TABLE (id int, title text, keyword_rank bigint, vector_rank bigint, score numeric)
LANGUAGE sql STABLE AS $$
  WITH kw AS (
    SELECT d.id, row_number() OVER (ORDER BY ts_rank(d.search, websearch_to_tsquery('english', query_text)) DESC) AS rnk
    FROM documents d
    WHERE d.search @@ websearch_to_tsquery('english', query_text)
    ORDER BY rnk LIMIT match_count * 4
  ),
  sem AS (
    SELECT d.id, row_number() OVER (ORDER BY d.embedding <=> query_embedding) AS rnk
    FROM documents d
    ORDER BY d.embedding <=> query_embedding LIMIT match_count * 4
  )
  SELECT d.id, d.title, kw.rnk, sem.rnk,
         round(COALESCE(keyword_weight / (rrf_k + kw.rnk), 0)
             + COALESCE(vector_weight  / (rrf_k + sem.rnk), 0), 5)
  FROM kw FULL OUTER JOIN sem USING (id) JOIN documents d USING (id)
  ORDER BY 5 DESC
  LIMIT match_count
$$;

-- exact phrase matters ("30 days"): boost keywords
SELECT * FROM hybrid_search('"30 days"', '[0,0.1,0,0.1,0.9]', 3, 2.0, 1.0);`,
      explain: `<p>The function takes the raw user text and the query embedding (computed by the app), retrieves 4x <code>match_count</code> candidates from each side, and fuses them with tunable weights and <code>k</code>. With <code>keyword_weight = 2</code> the phrase match "30 days" (document 18, the only one containing that phrase) scores 2/61 + 1/63 = 0.04866 and dominates, although the vector side alone ranked it only 3rd; the vector side contributes the other store-policy documents. Weights are a product decision - tune them on an evaluation set rather than guessing.</p>`,
      output: ` id | title                    | keyword_rank | vector_rank | score
----+--------------------------+--------------+-------------+---------
 18 | Return and refund policy |            1 |           3 | 0.04866
 19 | Shipping times           |              |           1 | 0.01639
 20 | Warranty claims          |              |           2 | 0.01613
(3 rows)`,
      run: true }
  ],
  compare: {
    bad: { sql: DOCS_EMB + `
-- adding raw scores from different scales: ts_rank (~0..1) + cosine similarity (-1..1)
SELECT id, title,
       ts_rank(search, websearch_to_tsquery('english', 'pgvector')) +
       (1 - (embedding <=> '[0.2,0.1,0.9,0.1,0]')) AS naive_score
FROM documents
ORDER BY naive_score DESC LIMIT 3;`, why: 'Raw scores live on different, query-dependent scales, so one signal silently dominates; computing ts_rank and distance for every row also prevents index use.', run: true },
    good: { sql: DOCS_EMB + `
WITH kw AS (
  SELECT id, row_number() OVER (ORDER BY ts_rank(search, websearch_to_tsquery('english', 'pgvector')) DESC) AS rnk
  FROM documents WHERE search @@ websearch_to_tsquery('english', 'pgvector') LIMIT 20),
sem AS (
  SELECT id, row_number() OVER (ORDER BY embedding <=> '[0.2,0.1,0.9,0.1,0]') AS rnk
  FROM documents ORDER BY embedding <=> '[0.2,0.1,0.9,0.1,0]' LIMIT 20)
SELECT id, round(COALESCE(1.0/(60+kw.rnk),0) + COALESCE(1.0/(60+sem.rnk),0), 5) AS rrf
FROM kw FULL OUTER JOIN sem USING (id)
ORDER BY rrf DESC LIMIT 3;`, why: 'RRF fuses ranks, which are scale-free, and each retriever uses its own index on a limited candidate list.', run: true }
  },
  mistakes: [
    'Adding <code>ts_rank</code> and cosine similarity directly - incompatible scales.',
    'Using an INNER JOIN between the two result lists - documents found by only one retriever disappear.',
    'Fusing unlimited result lists - forces full scans and ts_rank over every matching row.',
    'Using <code>to_tsquery</code> on raw user input - syntax errors on characters like <code>:</code> or <code>&amp;</code>; use <code>websearch_to_tsquery</code> or <code>plainto_tsquery</code>.',
    'Forgetting that the default <code>websearch_to_tsquery</code> ANDs all words - long natural-language questions often match nothing lexically.'
  ],
  best: [
    'Retrieve 20-50 candidates per retriever, fuse with RRF (k=60), return the top 5-10.',
    'Keep a GIN index on the tsvector column and HNSW on the embedding.',
    'Expose hybrid search as one SQL function with weights as parameters; tune on an evaluation set.',
    'Use the same filters (tenant, ACL, language) in both CTEs - or rely on RLS so they cannot diverge.',
    'Consider a cross-encoder re-ranker after fusion for the final top 5 when quality matters most.'
  ],
  performance: `<p>Both CTEs are index-driven: GIN bitmap scan for <code>@@</code> plus <code>ts_rank</code> on matches, and HNSW ORDER BY LIMIT for vectors. Total cost is roughly the sum of the two searches (often 5-30 ms). Very common words make the keyword side expensive (many matches to rank) - cap with LIMIT and consider <code>ts_rank_cd</code> only when needed. If one side is slow, run them in parallel from the app and fuse client-side, but in-database fusion keeps it to one round trip.</p>`,
  security: `<p>Pass user text only as a parameter to <code>websearch_to_tsquery</code> - never concatenate it into SQL. Apply tenant/permission filters (or RLS) to <em>both</em> retrievers; a common bug is filtering the vector side but not the keyword side, leaking other tenants' documents through keyword hits. Mark the function <code>SECURITY INVOKER</code> (default) so RLS applies.</p>`,
  scenario: { title: 'Users searching error codes get irrelevant answers from the RAG bot', steps: [
    '1. Sample failing queries: most contain identifiers (e.g. "53300 too_many_connections").',
    '2. Confirm vector-only retrieval misses them and keyword search finds them.',
    '3. Add/verify a generated tsvector column + GIN index on chunks.',
    '4. Implement RRF hybrid_search() with 40 candidates per side; evaluate weights 1:1 vs 2:1.',
    '5. Ship the best configuration and add these queries to the regression evaluation set.'
  ] },
  widgets: ['diagram:rag'],
  interview: [
    { q: 'Why does hybrid search beat pure vector search?', a: 'Embeddings capture meaning but blur rare exact tokens like product codes, error numbers and names, while lexical search matches those exactly but misses paraphrases. Combining both retrieves documents that either method would miss alone, and documents found by both are strong candidates.' },
    { q: 'Explain Reciprocal Rank Fusion.', a: 'Each retriever produces a ranked list; each document gets sum of 1/(k + rank) over the lists it appears in, with k typically 60. It uses ranks instead of raw scores, so it needs no score normalisation, and k controls how strongly top ranks dominate. Weights per retriever can be added.' },
    { q: 'How do you implement hybrid search in PostgreSQL?', a: 'Two CTEs: one ranks full-text matches with ts_rank using the GIN index on a tsvector column, the other ranks by pgvector distance using HNSW, each limited to a few dozen rows. FULL OUTER JOIN them on id, compute COALESCE(1/(k+rank),0) per side, sum, order and limit, typically wrapped in a SQL function.' }
  ],
  exercises: [
    { task: 'List documents matching the keyword query "replication OR replicas" with ts_rank, best first.',
      solution: `SELECT id, title, round(ts_rank(search, websearch_to_tsquery('english', 'replication OR replicas'))::numeric, 4) AS rank
FROM documents
WHERE search @@ websearch_to_tsquery('english', 'replication OR replicas')
ORDER BY rank DESC;`, run: true },
    { task: 'Run RRF with k = 10 instead of 60 for the keyword "security" and the vector [0.2,0.3,0,0.95,0], top 3.',
      solution: DOCS_EMB + `
WITH kw AS (
  SELECT id, row_number() OVER (ORDER BY ts_rank(search, websearch_to_tsquery('english','security')) DESC) AS rnk
  FROM documents WHERE search @@ websearch_to_tsquery('english','security') LIMIT 20),
sem AS (
  SELECT id, row_number() OVER (ORDER BY embedding <=> '[0.2,0.3,0,0.95,0]') AS rnk
  FROM documents ORDER BY embedding <=> '[0.2,0.3,0,0.95,0]' LIMIT 20)
SELECT d.id, d.title, round(COALESCE(1.0/(10+kw.rnk),0) + COALESCE(1.0/(10+sem.rnk),0), 4) AS rrf
FROM kw FULL OUTER JOIN sem USING (id) JOIN documents d USING (id)
ORDER BY rrf DESC LIMIT 3;`, run: true }
  ],
  challenge: { task: 'Extend RRF with a third retriever: trigram similarity on title (pg_trgm extension) for the misspelled query "pgbouncr", fused with keyword and vector lists.',
    hint: 'CREATE EXTENSION pg_trgm; third CTE ranks by similarity(title, q) DESC for rows where title % q or similarity > 0.1.',
    solution: DOCS_EMB + `
CREATE EXTENSION IF NOT EXISTS pg_trgm;
WITH kw AS (
  SELECT id, row_number() OVER (ORDER BY ts_rank(search, websearch_to_tsquery('english','pgbouncr')) DESC) AS rnk
  FROM documents WHERE search @@ websearch_to_tsquery('english','pgbouncr') LIMIT 20),
sem AS (
  SELECT id, row_number() OVER (ORDER BY embedding <=> '[0.2,0.85,0,0.2,0]') AS rnk
  FROM documents ORDER BY embedding <=> '[0.2,0.85,0,0.2,0]' LIMIT 20),
trg AS (
  SELECT id, row_number() OVER (ORDER BY similarity(title, 'pgbouncr') DESC) AS rnk
  FROM documents WHERE similarity(title, 'pgbouncr') > 0.1 LIMIT 20)
SELECT d.id, d.title, kw.rnk AS kw, sem.rnk AS vec, trg.rnk AS trigram,
       round(COALESCE(1.0/(60+kw.rnk),0) + COALESCE(1.0/(60+sem.rnk),0) + COALESCE(1.0/(60+trg.rnk),0), 5) AS rrf
FROM kw
FULL OUTER JOIN sem USING (id)
FULL OUTER JOIN trg USING (id)
JOIN documents d USING (id)
ORDER BY rrf DESC LIMIT 3;`, run: true },
  related: ['full-text-search', 'ai-rag-architecture', 'vector-search-semantic-end-to-end', 'ai-rag-production'],
  quiz: [
    { type: 'predict', q: 'RRF score (k=60) of a document ranked 1st by keyword and absent from the vector list?', code: `SELECT COALESCE(1.0/(60+1),0) + COALESCE(1.0/(60+NULL),0);`, options: ['0.0164', '0.0328', '0', 'NULL'], answer: 0, explain: '1/61 = 0.0164; the missing side contributes 0 via COALESCE.' },
    { type: 'mcq', q: 'Why use FULL OUTER JOIN when fusing?', options: ['It is faster', 'To keep documents found by only one retriever', 'To remove duplicates', 'Required by RRF math'], answer: 1, explain: 'An inner join would drop single-retriever hits.' },
    { type: 'tf', q: 'tsvector full-text search is a core PostgreSQL feature, while vector similarity requires the pgvector extension.', answer: true, explain: 'Full-text search is built in; pgvector is an extension.' },
    { type: 'bug', q: 'Find the bug', code: `SELECT id, ts_rank(search, q) + (1 - (embedding <=> $1)) AS score FROM documents, to_tsquery($2) q ORDER BY score DESC LIMIT 5;`, options: ['Mixing incompatible score scales and to_tsquery on raw user input', 'Missing GROUP BY', 'LIMIT too small', 'Needs DISTINCT'], answer: 0, explain: 'Use rank-based fusion and websearch_to_tsquery for user text.' }
  ]
},
/* ------------------------------------------------------------------ */
{
  id: 'ai-rag-production',
  module: 'ai-rag',
  title: 'Production RAG on PostgreSQL: Multi-Tenancy, RLS, Caching, Evaluation',
  level: 7,
  minutes: 30,
  summary: 'Run RAG for many tenants safely: tenant filtering, Row Level Security on chunks, semantic caching, evaluation loops, and when a dedicated vector database is justified.',
  objectives: [
    'Design a multi-tenant chunks table with tenant filtering and indexes',
    'Enforce document security with Row Level Security on vector queries',
    'Implement a semantic answer cache keyed by query embedding',
    'Build an offline evaluation loop (recall@k, answer quality) in SQL',
    'Write the full app-layer flow around SQL',
    'Decide between pgvector and a dedicated vector database'
  ],
  concept: `<p>A demo RAG returns good answers; a production RAG must also be <strong>secure, multi-tenant, fast, observable and evaluated</strong>. PostgreSQL gives you all of these with features you already know.</p>
<p><strong>Analogy - a shared office library.</strong> Many companies (tenants) rent space in one building. Each company's books sit on the same shelves, but a security guard (RLS) checks every reader's badge and hides books from other companies - even if a reader asks cleverly (prompt injection) or the receptionist (application) makes a mistake. A front-desk notebook of recent questions and answers (semantic cache) saves trips to the shelves, and a monthly quiz (evaluation) checks the librarians still find the right books.</p>
<h4>Production building blocks</h4>
<table>
<tr><th>Concern</th><th>PostgreSQL feature</th></tr>
<tr><td>Tenant isolation</td><td><code>tenant_id</code> on every chunk + RLS policy using <code>current_setting('app.tenant_id')</code>; B-tree on tenant_id; partitioning for large tenants</td></tr>
<tr><td>Document permissions</td><td><code>allowed_groups int[]</code> + GIN index, policy <code>allowed_groups &amp;&amp; current user's groups</code></td></tr>
<tr><td>Filtered ANN quality</td><td>pgvector 0.8 <code>hnsw.iterative_scan</code></td></tr>
<tr><td>Latency/cost</td><td>Semantic cache table (query embedding -&gt; answer, TTL); connection pooling (PgBouncer, <span class="tag tool">third-party tool</span>)</td></tr>
<tr><td>Observability</td><td>rag_log table, <code>pg_stat_statements</code> (extension) for query latency</td></tr>
<tr><td>Evaluation</td><td>Golden question set + expected chunk ids; recall@k in SQL; answer grading offline</td></tr>
<tr><td>Freshness</td><td>Content hashes, re-embedding queue, <code>updated_at</code> filters</td></tr>
</table>
<h4>When to consider a dedicated vector database</h4>
<ul>
<li>Hundreds of millions to billions of vectors with very high QPS where sharding pgvector (Citus, application sharding) becomes harder than adopting a specialised system.</li>
<li>Need for features pgvector lacks natively (e.g. built-in multi-vector/late-interaction search, GPU indexing, product quantization with disk-based graphs - though extensions like pgvectorscale <span class="tag ext">extension</span> add some of these).</li>
<li>Otherwise PostgreSQL wins on simplicity: one system for data, vectors, permissions, transactions and backups; no sync pipeline; joins with business data.</li>
</ul>`,
  why: `<p>Most RAG incidents are not about model quality but about <em>data leaks between customers</em>, stale answers, runaway cost, and silent quality regressions. Enforcing isolation in the database (RLS) means a bug in one API endpoint cannot leak another tenant's contracts into a prompt. Caching and evaluation keep cost and quality under control as usage grows.</p>`,
  useCase: `<p>A B2B contract-analysis SaaS serves 1,400 law firms from one PostgreSQL 17 cluster: 85M chunks (1024-d halfvec), hash-partitioned by tenant into 32 partitions each with its own HNSW index. Every request runs <code>SET LOCAL app.tenant_id</code> inside a transaction through PgBouncer (transaction pooling); RLS policies plus <code>allowed_groups</code> enforce matter-level permissions. A semantic cache answers 23% of questions (repeated clause questions) in 8 ms without calling the LLM. A nightly evaluation job runs 1,200 golden questions per release and blocks deploys if recall@8 drops more than 2 points.</p>`,
  internals: `<p>RLS policies are added to the query as security-barrier quals: for vector searches they behave like WHERE filters applied after the index scan (post-filtering), so enable <code>hnsw.iterative_scan</code> and index <code>tenant_id</code>. Policy expressions must be cheap and ideally use leakproof operators so the planner can push them down. <code>current_setting('app.tenant_id', true)</code> reads a custom GUC set per transaction with <code>SET LOCAL</code> or <code>set_config(..., true)</code> - with transaction-mode pooling, session-level <code>SET</code> would leak between clients. Semantic caching is just another vector table: nearest previous question with distance below a strict threshold and an unexpired TTL.</p>`,
  whenNot: `<ul><li>Do not rely on application-only tenant filters for sensitive data - add RLS as defence in depth.</li>
<li>Do not semantic-cache personalised or time-sensitive answers (account balances, order status) - cache only tenant-scoped, static-knowledge answers, and include tenant_id in the cache key.</li>
<li>Do not move to a dedicated vector DB just because "it is built for vectors" - measure first; tens of millions of vectors are routine for pgvector.</li></ul>`,
  syntax: `# ---- application layer (pseudo-code) ----
def answer(user, question):
    q_vec = embed(question)                                   # embedding API, cached by text hash
    with db.transaction() as tx:
        tx.execute("SELECT set_config('app.tenant_id', %s, true)", user.tenant_id)   # SET LOCAL
        tx.execute("SELECT set_config('app.user_groups', %s, true)", user.groups_csv)
        hit = tx.fetchone("""SELECT answer FROM answer_cache
                             WHERE tenant_id = %s AND expires_at > now()
                               AND question_embedding <=> %s < 0.03
                             ORDER BY question_embedding <=> %s LIMIT 1""", ...)
        if hit: return hit.answer
        tx.execute("SET LOCAL hnsw.iterative_scan = relaxed_order")
        chunks = tx.fetchall("SELECT * FROM hybrid_search(%s, %s, 6)", question, q_vec)  # RLS applies
    if not chunks or chunks[0].score < MIN_SCORE: return "I could not find that in your documents."
    reply = llm(build_prompt(question, chunks))               # cite [chunk id]
    db.execute("INSERT INTO answer_cache ...; INSERT INTO rag_log ...")
    return reply`,
  examples: [
    { label: 'Basic', title: 'Multi-tenant chunks: tenant filter + iterative scan',
      sql: `CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE rag_chunks (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id int  NOT NULL,
  doc_title text NOT NULL,
  content   text NOT NULL,
  embedding vector(3) NOT NULL
);
CREATE INDEX rag_chunks_tenant ON rag_chunks (tenant_id);
CREATE INDEX rag_chunks_hnsw   ON rag_chunks USING hnsw (embedding vector_cosine_ops);
INSERT INTO rag_chunks (tenant_id, doc_title, content, embedding) VALUES
  (1, 'Acme leave policy',   'Employees get 24 days of paid leave.',        '[0.9,0.1,0.0]'),
  (1, 'Acme travel policy',  'Book economy class for flights under 6h.',    '[0.2,0.9,0.1]'),
  (2, 'Globex leave policy', 'Employees get 30 days of paid leave.',        '[0.9,0.1,0.0]'),
  (2, 'Globex IT policy',    'Laptops are replaced every 3 years.',         '[0.1,0.2,0.9]'),
  (3, 'Initech leave policy','Employees get 20 days of paid leave.',        '[0.88,0.12,0.0]');

SET hnsw.iterative_scan = relaxed_order;     -- pgvector 0.8+: avoid short filtered results
-- tenant 2 asks: "How many vacation days do I get?"
SELECT doc_title, content, round((embedding <=> '[0.95,0.05,0]')::numeric, 4) AS distance
FROM rag_chunks
WHERE tenant_id = 2
ORDER BY embedding <=> '[0.95,0.05,0]'
LIMIT 3;`,
      explain: `<p>Three tenants have nearly identical "leave policy" chunks; the vector alone cannot tell them apart - only <code>tenant_id</code> can. The application adds <code>WHERE tenant_id = 2</code>; the B-tree on <code>tenant_id</code> lets the planner choose exact pre-filtering for small tenants, and the iterative scan setting protects large ones from overfiltering. Getting this filter wrong means Globex employees read Acme's policy - which is why the next example moves it into RLS.</p>`,
      output: ` doc_title           | content                              | distance
---------------------+--------------------------------------+----------
 Globex leave policy | Employees get 30 days of paid leave. |   0.0017
 Globex IT policy    | Laptops are replaced every 3 years.  |   0.8810
(2 rows)`,
      run: true },
    { label: 'Intermediate', title: 'Row Level Security on vector search (tenant + group ACL)',
      sql: `CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE rag_chunks (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id      int    NOT NULL,
  allowed_groups int[]  NOT NULL DEFAULT '{}',   -- empty = everyone in tenant
  content        text   NOT NULL,
  embedding      vector(3) NOT NULL
);
INSERT INTO rag_chunks (tenant_id, allowed_groups, content, embedding) VALUES
  (1, '{}',   'Holiday calendar 2025',              '[0.9,0.1,0.0]'),
  (1, '{10}', 'Executive salary bands (HR only)',   '[0.85,0.15,0.0]'),
  (2, '{}',   'Globex holiday calendar',            '[0.9,0.1,0.0]');

CREATE ROLE rag_app NOLOGIN;                     -- the retrieval service role (not superuser)
GRANT SELECT ON rag_chunks TO rag_app;
ALTER TABLE rag_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_and_groups ON rag_chunks FOR SELECT TO rag_app
USING (
  tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::int
  AND (allowed_groups = '{}'
       OR allowed_groups && string_to_array(NULLIF(current_setting('app.user_groups', true), ''), ',')::int[])
);

-- request from a tenant-1 user who is NOT in group 10
SELECT set_config('app.tenant_id', '1', false), set_config('app.user_groups', '20', false);
SET ROLE rag_app;
SELECT content, round((embedding <=> '[0.9,0.1,0]')::numeric, 4) AS distance
FROM rag_chunks ORDER BY embedding <=> '[0.9,0.1,0]' LIMIT 5;
RESET ROLE;`,
      explain: `<p>The policy combines tenant isolation and a per-document ACL. The query itself has <strong>no WHERE clause</strong>: RLS silently adds the predicate, so even a buggy or prompt-injected code path cannot retrieve Globex rows or the HR-only chunk. <code>NULLIF(current_setting(..., true), '')</code> makes a missing setting yield NULL (no rows) instead of an error. PGlite and most local setups run as a superuser, which bypasses RLS - so we <code>SET ROLE</code> to a normal role, exactly as a production app connects as a non-superuser. In production use <code>set_config(..., true)</code> / <code>SET LOCAL</code> inside the request transaction.</p>`,
      output: ` content               | distance
-----------------------+----------
 Holiday calendar 2025 |   0.0000
(1 row)`,
      run: true },
    { label: 'Advanced', title: 'Semantic answer cache with TTL',
      sql: `CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE answer_cache (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id          int NOT NULL,
  question           text NOT NULL,
  question_embedding vector(3) NOT NULL,
  answer             text NOT NULL,
  source_ids         int[] NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL DEFAULT now() + interval '7 days'
);
CREATE INDEX answer_cache_hnsw ON answer_cache USING hnsw (question_embedding vector_cosine_ops);
INSERT INTO answer_cache (tenant_id, question, question_embedding, answer, source_ids, expires_at) VALUES
  (1, 'How many leave days do I get?', '[0.9,0.1,0.0]', 'You get 24 days of paid leave [doc 1].', '{1}', now() + interval '7 days'),
  (1, 'What is the laptop refresh cycle?', '[0.1,0.2,0.9]', 'Every 3 years [doc 4].', '{4}', now() - interval '1 day'),  -- expired
  (2, 'How many leave days do I get?', '[0.9,0.1,0.0]', 'You get 30 days [doc 3].', '{3}', now() + interval '7 days');

-- new question from tenant 1: "How much annual leave is there?" embedded as [0.89,0.11,0.01]
SELECT question, answer, round((question_embedding <=> '[0.89,0.11,0.01]')::numeric, 5) AS distance
FROM answer_cache
WHERE tenant_id = 1
  AND expires_at > now()
  AND question_embedding <=> '[0.89,0.11,0.01]' < 0.02       -- strict threshold: near-duplicate questions only
ORDER BY question_embedding <=> '[0.89,0.11,0.01]'
LIMIT 1;`,
      explain: `<p>A semantic cache stores previous questions with their embeddings and answers. A new question that is a near-paraphrase (cosine distance below a strict threshold) of a cached one for the <em>same tenant</em> and still valid returns the cached answer in milliseconds, skipping the LLM. Tenant 2's identical question is ignored (different tenant) and the expired entry is ignored by the TTL check. Keep thresholds strict - a wrong cache hit is worse than a slow answer - and invalidate entries whose <code>source_ids</code> change.</p>`,
      output: ` question                      | answer                                 | distance
-------------------------------+----------------------------------------+----------
 How many leave days do I get? | You get 24 days of paid leave [doc 1]. |  0.00014
(1 row)`,
      run: true }
  ],
  compare: {
    bad: { sql: `CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE kb (tenant_id int, content text, embedding vector(2));
INSERT INTO kb VALUES (1,'Acme pricing: 10% discount','[1,0]'), (2,'Globex pricing: 25% discount','[1,0.01]');
-- tenant filter forgotten in one code path: the nearest chunk may belong to another customer
SELECT tenant_id, content FROM kb ORDER BY embedding <=> '[1,0.01]' LIMIT 1;`, why: 'Isolation depends on every query remembering WHERE tenant_id = ...; one missed filter leaks another tenant\'s data into the LLM prompt.', run: true },
    good: { sql: `CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE kb (tenant_id int, content text, embedding vector(2));
INSERT INTO kb VALUES (1,'Acme pricing: 10% discount','[1,0]'), (2,'Globex pricing: 25% discount','[1,0.01]');
CREATE ROLE kb_app NOLOGIN;
GRANT SELECT ON kb TO kb_app;
ALTER TABLE kb ENABLE ROW LEVEL SECURITY;
CREATE POLICY kb_tenant ON kb USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::int);
SELECT set_config('app.tenant_id', '1', false);
SET ROLE kb_app;
SELECT tenant_id, content FROM kb ORDER BY embedding <=> '[1,0.01]' LIMIT 1;   -- same query, now safe
RESET ROLE;`, why: 'With RLS the database enforces the tenant predicate on every query, even ones that forget the WHERE clause.', run: true }
  },
  mistakes: [
    'Using session-level <code>SET app.tenant_id</code> with transaction-mode PgBouncer - the next client on that server connection inherits the previous tenant. Use <code>SET LOCAL</code>/<code>set_config(..., true)</code> inside a transaction.',
    'Testing RLS as a superuser or the table owner and concluding it works (they bypass RLS unless FORCE ROW LEVEL SECURITY is set - superusers always bypass).',
    'Filtering the vector retriever by tenant but not the keyword retriever in hybrid search.',
    'Caching answers without tenant_id in the key, or with loose similarity thresholds.',
    'No evaluation set - prompt/model/chunking changes ship blind.',
    'Granting the retrieval service role INSERT/UPDATE/DELETE or ownership of the tables.'
  ],
  best: [
    'Put <code>tenant_id</code> on every row, index it, and enforce it with RLS; the app connects as a non-owner, non-superuser role.',
    'Set request context with <code>set_config(\'app.tenant_id\', $1, true)</code> at the start of each transaction.',
    'Enable <code>hnsw.iterative_scan</code> so RLS/tenant filters do not truncate results; partition very large tenants.',
    'Log retrieval and answers; maintain a golden evaluation set; gate deployments on recall@k.',
    'Cache conservatively (tenant-scoped, strict threshold, TTL, invalidation on source change).',
    'Stay on PostgreSQL until measurements (scale, QPS, features) prove a dedicated vector DB is needed.'
  ],
  performance: `<p>RLS adds a predicate per row; keep policy expressions simple (integer equality, array overlap with a GIN index) and avoid subqueries per row. <code>current_setting()</code> is stable within a statement, so it is evaluated once. For large multi-tenant corpora, partition by tenant (hash or list) so each HNSW graph is smaller and partition pruning skips other tenants. Semantic cache lookups are cheap HNSW queries on a small table; they pay off when repeated questions are common (support bots: often 15-40%).</p>`,
  security: `<p>Defence in depth: (1) application authenticates and sets tenant context, (2) database role has only SELECT on retrieval tables, (3) RLS enforces tenant and ACL, (4) prompt-injection-resistant prompting and output filtering, (5) audit logs of retrieved ids per request. Never use a <code>SECURITY DEFINER</code> retrieval function owned by a BYPASSRLS/superuser role. Review <code>pg_policies</code> in CI so a migration cannot silently disable RLS.</p>`,
  scenario: { title: 'Security review: "Can tenant A ever see tenant B\'s chunks?"', steps: [
    '1. List tables with chunks/embeddings and verify relrowsecurity = true (and relforcerowsecurity if the app role owns them).',
    '2. Inspect pg_policies: every policy compares tenant_id with current_setting(\'app.tenant_id\', true).',
    '3. Confirm the app role is not superuser, not BYPASSRLS, not the table owner.',
    '4. Confirm set_config(..., true) / SET LOCAL per transaction with PgBouncer transaction pooling.',
    '5. Add an automated test: SET ROLE app; set tenant 1; assert zero rows with tenant_id <> 1 from search functions, keyword and vector paths.'
  ] },
  widgets: ['diagram:rag', 'diagram:multi-tenant'],
  interview: [
    { q: 'How do you secure a multi-tenant RAG system on PostgreSQL?', a: 'Store tenant_id (and ACL groups) on every chunk, connect as a non-superuser, non-owner role, set the tenant in a transaction-local GUC per request, and enforce isolation with RLS policies so every query, vector or keyword, is filtered by the database. Index tenant_id, use iterative scans to avoid truncated results, and test isolation automatically.' },
    { q: 'What is a semantic cache and what are its risks?', a: 'A table of previous questions, their embeddings and answers; a new question whose embedding is very close to a cached one returns the cached answer without calling the LLM. Risks are wrong hits from loose thresholds, cross-tenant leaks if the key lacks tenant_id, and stale answers - mitigate with strict thresholds, tenant scoping, TTLs and invalidation.' },
    { q: 'When would you move from pgvector to a dedicated vector database?', a: 'When measured requirements exceed what a well-tuned, possibly sharded PostgreSQL can deliver - typically hundreds of millions to billions of vectors at high QPS, or features like GPU indexing or advanced quantization not available via pgvector or related extensions. Otherwise keeping vectors with relational data, permissions and transactions in PostgreSQL is simpler and safer.' },
    { q: 'Why is session-level SET dangerous with PgBouncer?', a: 'In transaction pooling mode, consecutive transactions from different clients share server connections. A session-level SET app.tenant_id persists on that server connection and can be observed by the next client, causing cross-tenant access. SET LOCAL or set_config with is_local = true scopes the value to the transaction.' }
  ],
  exercises: [
    { task: 'Write a query that lists all tables in the public schema with RLS enabled and how many policies each has.',
      solution: `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity, count(p.policyname) AS policies
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_policies p ON p.schemaname = n.nspname AND p.tablename = c.relname
WHERE n.nspname = 'public' AND c.relkind = 'r'
GROUP BY c.relname, c.relrowsecurity, c.relforcerowsecurity
ORDER BY c.relname;`, run: true },
    { task: 'Build a tiny evaluation: a golden table of (question_vec, expected_doc_id) for 3 questions over the toy documents, and compute hit-rate@3.',
      solution: DOCS_EMB + `
CREATE TEMP TABLE golden (question text, qvec vector(5), expected_id int);
INSERT INTO golden VALUES
  ('How do refunds work?',        '[0,0,0,0.1,0.95]',   18),
  ('How do I add read replicas?', '[0.3,0.9,0,0.1,0]',  5),
  ('What is RAG?',                '[0.1,0.2,0.95,0.1,0]', 8);
SELECT round(avg(CASE WHEN g.expected_id = ANY (top.ids) THEN 1 ELSE 0 END), 3) AS hit_rate_at_3
FROM golden g
CROSS JOIN LATERAL (
  SELECT array_agg(id) AS ids FROM (
    SELECT id FROM documents ORDER BY embedding <=> g.qvec LIMIT 3) t
) top;`, run: true }
  ],
  challenge: { task: 'Create a SECURITY INVOKER search function over an RLS-protected chunks table and prove that calling it as the app role for tenant 2 never returns tenant 1 rows, while the same function called by the superuser returns both (superusers bypass RLS).',
    hint: 'Functions are SECURITY INVOKER by default; compare results before and after SET ROLE.',
    solution: `CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE t_chunks (tenant_id int, content text, embedding vector(2));
INSERT INTO t_chunks VALUES (1, 'tenant one secret', '[1,0]'), (2, 'tenant two doc', '[0.9,0.1]');
ALTER TABLE t_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY p ON t_chunks USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::int);
CREATE FUNCTION search_chunks(q vector(2), k int)
RETURNS TABLE (tenant_id int, content text)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT tenant_id, content FROM t_chunks ORDER BY embedding <=> q LIMIT k
$$;
CREATE ROLE t_app NOLOGIN;
GRANT SELECT ON t_chunks TO t_app;
GRANT EXECUTE ON FUNCTION search_chunks(vector, int) TO t_app;
SELECT 'superuser' AS caller, * FROM search_chunks('[1,0]', 5);
SELECT set_config('app.tenant_id', '2', false);
SET ROLE t_app;
SELECT 'app role, tenant 2' AS caller, * FROM search_chunks('[1,0]', 5);
RESET ROLE;`, run: true },
  related: ['row-level-security-multi-tenant-saas', 'ai-rag-hybrid-search', 'vector-search-filtering', 'row-level-security'],
  quiz: [
    { type: 'mcq', q: 'How should the tenant id be set per request with PgBouncer transaction pooling?', options: ['SET app.tenant_id = 5 once per connection', 'set_config(\'app.tenant_id\', \'5\', true) / SET LOCAL inside the transaction', 'ALTER ROLE app SET app.tenant_id', 'In the LLM prompt'], answer: 1, explain: 'Transaction-local settings cannot leak to the next client sharing the server connection.' },
    { type: 'tf', q: 'A superuser running the search query sees only its tenant rows when RLS is enabled.', answer: false, explain: 'Superusers (and BYPASSRLS roles) bypass RLS entirely.' },
    { type: 'scenario', q: 'A semantic cache returned tenant B\'s answer to tenant A. Root cause?', options: ['HNSW bug', 'Cache lookup not scoped by tenant_id (and/or RLS missing on the cache table)', 'Threshold too strict', 'TTL too long'], answer: 1, explain: 'Cache keys and RLS must include the tenant.' },
    { type: 'design', q: '40M chunks, 20 QPS, needs joins with customer contracts and per-matter permissions. Retrieval store?', options: ['Dedicated vector DB + nightly sync', 'PostgreSQL + pgvector with RLS (halfvec/HNSW, partitioning if needed)', 'Elasticsearch only', 'Flat files'], answer: 1, explain: 'Well within pgvector scale, and relational joins/permissions favour PostgreSQL.' }
  ]
}
]);

PGM.addLessons([
/* ------------------------------------------------------------------ */
{
  id: 'security-authentication-pg-hba',
  module: 'security',
  title: 'Authentication: pg_hba.conf, SCRAM-SHA-256, md5 and trust',
  level: 4,
  minutes: 24,
  summary: 'How PostgreSQL decides who may connect: pg_hba.conf rules (type, database, user, address, method), SCRAM vs deprecated md5 vs trust, and password_encryption.',
  objectives: [
    'Read and write pg_hba.conf lines: TYPE DATABASE USER ADDRESS METHOD [OPTIONS]',
    'Explain first-match-wins rule ordering and reload behaviour',
    'Compare trust, peer, scram-sha-256, md5, cert and ldap/gssapi methods',
    'Migrate passwords from md5 to SCRAM with password_encryption',
    'Inspect active rules with pg_hba_file_rules and stored hashes in pg_authid',
    'Avoid common lock-out and over-exposure mistakes'
  ],
  concept: `<p>Before any SQL runs, the postmaster checks <span class="tag core">core</span> <code>pg_hba.conf</code> ("host-based authentication"). Each line is a rule; PostgreSQL scans top to bottom and uses the <strong>first line</strong> whose connection type, database, user and client address match. The line's <strong>method</strong> then decides how the client must prove its identity. If no line matches, the connection is rejected.</p>
<p><strong>Analogy - a building's security desk with a rule book.</strong> "Staff entering through the internal door (local socket) need only their face (peer)", "visitors from the office network (10.0.0.0/8) must show a passport (scram-sha-256)", "anyone else: denied (reject)". The guard reads the rules in order and applies the first one that fits - so putting a generous rule above a strict one makes the strict one useless.</p>
<h4>Line format</h4>
<p><code>TYPE  DATABASE  USER  ADDRESS  METHOD  [OPTIONS]</code></p>
<table>
<tr><th>Field</th><th>Values</th></tr>
<tr><td>TYPE</td><td><code>local</code> (Unix socket), <code>host</code> (TCP, SSL or not), <code>hostssl</code> (TCP with TLS only), <code>hostnossl</code>, <code>hostgssenc</code>, <code>hostnogssenc</code></td></tr>
<tr><td>DATABASE</td><td><code>all</code>, a name, comma list, <code>sameuser</code>, <code>samerole</code>, <code>replication</code>, <code>@file</code></td></tr>
<tr><td>USER</td><td><code>all</code>, a role name, <code>+group</code> (members of a role), comma list, regex <code>/^app_</code> (PG16+)</td></tr>
<tr><td>ADDRESS</td><td>CIDR (<code>10.0.0.0/8</code>, <code>::1/128</code>), hostname, <code>samehost</code>, <code>samenet</code>; omitted for <code>local</code></td></tr>
<tr><td>METHOD</td><td><code>scram-sha-256</code>, <code>md5</code>, <code>password</code>, <code>trust</code>, <code>reject</code>, <code>peer</code>, <code>ident</code>, <code>cert</code>, <code>gss</code>, <code>sspi</code>, <code>ldap</code>, <code>radius</code>, <code>pam</code>, <code>oauth</code> (PG18)</td></tr>
</table>
<h4>Methods compared</h4>
<ul>
<li><strong>trust</strong> - no authentication at all; anyone who can reach the socket/port may connect as <em>any</em> role, including <code>postgres</code>. Acceptable only for throwaway local dev or in-process databases like PGlite.</li>
<li><strong>peer</strong> - Unix socket only; OS user name must match DB role (via <code>pg_ident.conf</code> maps). Great for local admin access.</li>
<li><strong>scram-sha-256</strong> - salted challenge-response (RFC 7677); the password never crosses the wire and the stored verifier cannot be replayed. Default <code>password_encryption</code> since PG14. <strong>Use this.</strong></li>
<li><strong>md5</strong> - legacy; stored hash is <code>md5(password || username)</code>, which is a password-equivalent if stolen (pass-the-hash) and weak against brute force. <strong>Deprecated in PostgreSQL 18</strong> (warnings when md5 passwords are set; removal planned). Note: an <code>md5</code> line still accepts SCRAM-hashed passwords using SCRAM.</li>
<li><strong>password</strong> - cleartext password over the wire; never without TLS (and preferably never).</li>
<li><strong>cert</strong> - client TLS certificate CN must match the role; strong for service-to-service.</li>
<li><strong>ldap / gss (Kerberos) / radius / pam / oauth</strong> - delegate to enterprise identity.</li>
</ul>
<p>Changes to <code>pg_hba.conf</code> take effect after a reload: <code>SELECT pg_reload_conf();</code> or <code>pg_ctl reload</code>. Check for syntax errors first with the <code>pg_hba_file_rules</code> view (its <code>error</code> column) - a broken file is ignored on reload, and the old rules stay in force.</p>`,
  why: `<p>Authentication is the outer wall. A single <code>host all all 0.0.0.0/0 trust</code> line (common in quick Docker setups) gives the whole internet superuser access - attackers scan for open 5432 ports continuously and use them for data theft and crypto-mining via <code>COPY ... PROGRAM</code>. Proper rules restrict <em>who</em>, <em>from where</em>, <em>to which database</em> and <em>how strongly</em>.</p>`,
  useCase: `<p>A fintech runs PostgreSQL in a private subnet. Their <code>pg_hba.conf</code>: local socket <code>peer</code> for the <code>postgres</code> OS user (DBA maintenance), <code>hostssl</code> + <code>scram-sha-256</code> for application roles from the app subnet 10.20.0.0/16, <code>hostssl</code> + <code>cert</code> for the replication user from the standby IPs only, LDAP for analysts from the VPN range, and a final <code>host all all 0.0.0.0/0 reject</code>. A quarterly audit query flags any role whose stored hash still starts with <code>md5</code>.</p>`,
  internals: `<p>The postmaster parses <code>pg_hba.conf</code> at startup and on SIGHUP into an in-memory list. For each new connection, a backend process is forked, the startup packet (user, database, options) is read, the rule list is matched, and the chosen method's exchange runs. SCRAM: the server stores <code>SCRAM-SHA-256$iterations:salt$StoredKey:ServerKey</code> in <code>pg_authid.rolpassword</code>; client and server exchange nonces, the client proves knowledge of the password via HMAC proofs, and the server proves it knows the verifier (mutual authentication). <code>scram_iterations</code> (default 4096, PG16+) controls hashing cost. <code>password_encryption</code> only affects how <em>newly set</em> passwords are stored - existing md5 hashes remain until each password is reset.</p>`,
  whenNot: `<ul><li>Never use <code>trust</code> on any network-reachable interface or shared machine.</li>
<li>Do not use <code>md5</code> for new deployments; do not use <code>password</code> at all.</li>
<li>Do not rely on <code>pg_hba.conf</code> alone - combine with firewalls/security groups, <code>listen_addresses</code>, TLS and least-privilege roles.</li></ul>`,
  syntax: `# pg_hba.conf  -  TYPE   DATABASE   USER        ADDRESS          METHOD          [OPTIONS]
local     all        postgres                     peer
local     all        all                          scram-sha-256
hostssl   app_db     app_rw      10.20.0.0/16     scram-sha-256
hostssl   app_db     +analysts   10.50.0.0/16     ldap ldapserver=ldap.corp ldapbasedn="dc=corp" ldapsearchattribute=uid
hostssl   replication replicator 10.20.5.11/32    cert
host      all        all         0.0.0.0/0        reject
host      all        all         ::/0             reject

-- SQL side
SHOW password_encryption;                       -- scram-sha-256 (default since PG14)
SELECT pg_reload_conf();                        -- apply pg_hba.conf changes
SELECT * FROM pg_hba_file_rules;                -- parsed rules + errors`,
  examples: [
    { label: 'Basic', title: 'Inspect the active pg_hba.conf rules',
      sql: `SELECT rule_number, type, database, user_name, address, netmask, auth_method, error
FROM   pg_hba_file_rules
ORDER  BY rule_number;`,
      explain: `<p><code>pg_hba_file_rules</code> (readable by superusers by default; access can be granted on the underlying function) shows how PostgreSQL parsed the file, in matching order, with any <code>error</code> per line. This in-browser PGlite instance uses <code>trust</code> everywhere because it is an embedded, single-user database with no network listener - exactly the configuration you must <strong>never</strong> ship on a real server. Production files end with explicit <code>reject</code> lines and use <code>scram-sha-256</code>, <code>peer</code> or <code>cert</code>.</p>`,
      output: ` rule_number | type  | database      | user_name | address   | netmask         | auth_method | error
-------------+-------+---------------+-----------+-----------+-----------------+-------------+-------
           1 | local | {all}         | {all}     |           |                 | trust       |
           2 | host  | {all}         | {all}     | 127.0.0.1 | 255.255.255.255 | trust       |
           3 | host  | {all}         | {all}     | ::1       | ffff:ffff:...   | trust       |
           4 | local | {replication} | {all}     |           |                 | trust       |
           5 | host  | {replication} | {all}     | 127.0.0.1 | 255.255.255.255 | trust       |
           6 | host  | {replication} | {all}     | ::1       | ffff:ffff:...   | trust       |
(6 rows)`,
      run: true },
    { label: 'Intermediate', title: 'md5 vs SCRAM: what is actually stored',
      sql: `SET password_encryption = 'md5';               -- legacy (PG18 warns: md5 is deprecated)
CREATE ROLE legacy_user LOGIN PASSWORD 'secret';
RESET password_encryption;                         -- back to scram-sha-256
CREATE ROLE modern_user LOGIN PASSWORD 'secret';

SELECT rolname,
       split_part(rolpassword, '$', 1) AS scheme,
       left(rolpassword, 40)          AS stored_value_prefix
FROM   pg_authid
WHERE  rolname IN ('legacy_user', 'modern_user');

-- the md5 "hash" is just md5(password || username): same for every server, no salt
SELECT 'md5' || md5('secret' || 'legacy_user') AS recomputed_md5;`,
      explain: `<p>The same password produces very different stored values. The md5 value is <code>'md5' || md5(password || username)</code>: unsalted per server, so it can be precomputed, and it is <em>password-equivalent</em> - whoever steals it can log in via the md5 protocol without knowing the password. The SCRAM verifier contains an iteration count (4096), a random salt and derived keys; stealing it does not let an attacker authenticate. <code>pg_authid</code> is readable only by superusers (<code>pg_roles</code> shows <code>********</code>).</p>`,
      output: ` rolname     | scheme                              | stored_value_prefix
-------------+-------------------------------------+------------------------------------------
 legacy_user | md50faf0d35e8bdfd638ae98152897128e2 | md50faf0d35e8bdfd638ae98152897128e2
 modern_user | SCRAM-SHA-256                       | SCRAM-SHA-256$4096:<random salt>...
(2 rows)

 recomputed_md5
-------------------------------------
 md50faf0d35e8bdfd638ae98152897128e2
(1 row)`,
      run: true },
    { label: 'Advanced', title: 'Audit login roles: md5 hashes, missing passwords, expiry',
      sql: `SET password_encryption = 'md5';
CREATE ROLE old_app LOGIN PASSWORD 'old';
RESET password_encryption;
CREATE ROLE new_app LOGIN PASSWORD 'n3w-Str0ng' VALID UNTIL '2030-01-01';
CREATE ROLE no_pw_login LOGIN;                       -- can only log in via peer/cert/trust/ldap

SELECT rolname,
       CASE
         WHEN rolpassword IS NULL            THEN 'no password (non-password auth only)'
         WHEN rolpassword LIKE 'md5%'        THEN 'md5 - reset password to upgrade to SCRAM'
         WHEN rolpassword LIKE 'SCRAM-SHA-256$%' THEN 'scram-sha-256 ok'
       END AS password_status,
       rolvaliduntil,
       rolsuper, rolbypassrls
FROM   pg_authid
WHERE  rolcanlogin AND rolname IN ('old_app', 'new_app', 'no_pw_login', 'postgres')
ORDER  BY rolname;`,
      explain: `<p>A periodic audit query for login roles: md5 hashes must be upgraded (setting <code>password_encryption = 'scram-sha-256'</code> does not convert existing hashes - each role must set its password again, e.g. via <code>\\password</code> in psql, which hashes client-side), roles without passwords should only match <code>peer</code>/<code>cert</code>/<code>ldap</code> lines, and <code>VALID UNTIL</code> enforces rotation for human accounts. Superuser and BYPASSRLS login roles deserve special scrutiny.</p>`,
      output: ` rolname     | password_status                          | rolvaliduntil          | rolsuper | rolbypassrls
-------------+------------------------------------------+------------------------+----------+--------------
 new_app     | scram-sha-256 ok                         | 2030-01-01 00:00:00+00 | f        | f
 no_pw_login | no password (non-password auth only)     |                        | f        | f
 old_app     | md5 - reset password to upgrade to SCRAM |                        | f        | f
 postgres    | no password (non-password auth only)     |                        | t        | t
(4 rows)`,
      run: true }
  ],
  compare: {
    bad: { sql: `# pg_hba.conf (DANGEROUS - typical "make Docker work" config)
host    all   all   0.0.0.0/0   trust
host    all   all   10.0.0.0/8  scram-sha-256    # never reached: first match wins`, why: 'trust from any IPv4 address lets anyone on the network connect as any role, including the superuser; the stricter line below is dead because the first matching rule wins.', run: false },
    good: { sql: `# pg_hba.conf (ordered from most specific to catch-all reject)
local     all          postgres                    peer
hostssl   app_db       app_rw       10.20.0.0/16   scram-sha-256
hostssl   replication  replicator   10.20.5.11/32  cert
host      all          all          0.0.0.0/0      reject
host      all          all          ::/0           reject`, why: 'Specific rules first, TLS required for TCP, SCRAM or certificates for authentication, and an explicit reject at the end.', run: false }
  },
  mistakes: [
    '<code>host all all 0.0.0.0/0 trust</code> or <code>md5</code> exposed to the internet.',
    'Placing a broad rule above a specific one - first match wins, the specific rule never applies.',
    'Editing pg_hba.conf and forgetting <code>SELECT pg_reload_conf()</code>, or reloading a file with a syntax error (check <code>pg_hba_file_rules.error</code>).',
    'Setting <code>password_encryption = scram-sha-256</code> and assuming existing md5 hashes were converted.',
    'Running <code>ALTER ROLE x PASSWORD \'...\'</code> in plain SQL where it lands in logs and history - prefer psql <code>\\password</code> (client-side hashing).',
    'Using a <code>host</code> line where <code>hostssl</code> was intended - allows unencrypted connections.'
  ],
  best: [
    'Use <code>scram-sha-256</code> for passwords, <code>peer</code> for local admin, <code>cert</code> or Kerberos/LDAP/OAuth for services and humans in enterprises.',
    'Prefer <code>hostssl</code> over <code>host</code>; end the file with explicit <code>reject</code> lines.',
    'Restrict DATABASE and USER per line (no <code>all all</code> on network lines).',
    'Audit <code>pg_authid</code> regularly for md5 hashes, passwordless login roles and expired accounts.',
    'Keep pg_hba.conf in configuration management; validate with <code>pg_hba_file_rules</code> before reloading.'
  ],
  performance: `<p>Authentication cost is per connection: SCRAM with 4096 iterations takes a few milliseconds of CPU, LDAP/RADIUS add a network round trip. With thousands of short connections per second this matters - use a connection pooler (PgBouncer, <span class="tag tool">third-party tool</span>) so clients authenticate to the pooler and server connections are reused. Raising <code>scram_iterations</code> strengthens stored verifiers against offline cracking at the cost of slower logins.</p>`,
  security: `<p>Authentication is necessary but not sufficient: combine with network isolation (<code>listen_addresses</code>, firewalls), TLS (next lesson), least-privilege roles, and logging (<code>log_connections</code>, <code>log_disconnections</code>, failed-login monitoring). Protect <code>pg_authid</code> and backups: they contain password verifiers.</p>`,
  scenario: { title: 'A security scan reports "PostgreSQL accepts md5 authentication from 0.0.0.0/0"', steps: [
    '1. Read pg_hba_file_rules to find the offending line and its position.',
    '2. Restrict the address to the application subnets and change TYPE to hostssl.',
    '3. Set password_encryption = scram-sha-256 and reset every md5 password (audit pg_authid for md5%).',
    '4. Change the method to scram-sha-256 once all hashes are upgraded; add catch-all reject lines.',
    '5. Reload (SELECT pg_reload_conf()), test logins from each client, and close port 5432 in the firewall for all other sources.'
  ] },
  widgets: ['lab:security', 'diagram:client-server'],
  interview: [
    { q: 'How does PostgreSQL choose an authentication method for a connection?', a: 'It scans pg_hba.conf top to bottom and uses the first rule whose connection type (local/host/hostssl...), database, user and client address match. That rule\'s method (scram-sha-256, peer, cert, reject, ...) is applied; if authentication fails, later rules are not tried, and if no rule matches the connection is rejected.' },
    { q: 'Why is SCRAM-SHA-256 better than md5?', a: 'SCRAM stores a salted, iterated verifier and uses a challenge-response so neither the password nor a replayable hash is sent, and it provides mutual authentication. md5 stores md5(password || username), which is unsalted per server and password-equivalent if stolen. md5 is deprecated in PostgreSQL 18.' },
    { q: 'You changed password_encryption to scram-sha-256. Are users protected now?', a: 'Only roles whose passwords are set after the change. Existing md5 hashes stay until each password is reset. Audit pg_authid for rolpassword LIKE md5%, reset them, then switch pg_hba methods to scram-sha-256.' },
    { q: 'When is trust acceptable?', a: 'Only where nobody untrusted can reach the server at all: a disposable local development instance on a Unix socket, an embedded database like PGlite, or CI containers without network exposure. Never on a networked or shared host.' }
  ],
  exercises: [
    { task: 'Show the current password_encryption and scram_iterations settings and where pg_hba.conf lives.',
      solution: `SELECT name, setting FROM pg_settings
WHERE name IN ('password_encryption', 'scram_iterations', 'hba_file')
ORDER BY name;`, run: true },
    { task: 'Create a login role reporting_user with a SCRAM password that expires at the end of 2026, then show its expiry from pg_roles.',
      solution: `CREATE ROLE reporting_user LOGIN PASSWORD 'Rep0rt!ng-2026' VALID UNTIL '2026-12-31 23:59:59+00';
SELECT rolname, rolcanlogin, rolvaliduntil FROM pg_roles WHERE rolname = 'reporting_user';`, run: true },
    { task: 'Write pg_hba.conf lines allowing role app_rw to database shop only over TLS from 10.1.0.0/16 using SCRAM, and rejecting everything else over TCP.',
      solution: `hostssl  shop  app_rw  10.1.0.0/16  scram-sha-256
host     all   all     0.0.0.0/0    reject
host     all   all     ::/0         reject`, run: false }
  ],
  challenge: { task: 'Write a query that lists every login-capable role with an md5 password, no password, or an expired VALID UNTIL, as a remediation report sorted by risk (superusers first).',
    hint: 'pg_authid has rolpassword, rolvaliduntil, rolsuper; ORDER BY rolsuper DESC.',
    solution: `SET password_encryption = 'md5';
CREATE ROLE risky_md5 LOGIN PASSWORD 'x';
RESET password_encryption;
CREATE ROLE risky_expired LOGIN PASSWORD 'y' VALID UNTIL '2020-01-01';
SELECT rolname, rolsuper,
       CASE WHEN rolpassword IS NULL THEN 'no password'
            WHEN rolpassword LIKE 'md5%' THEN 'md5 hash'
            WHEN rolvaliduntil < now() THEN 'expired'
       END AS issue
FROM pg_authid
WHERE rolcanlogin
  AND (rolpassword IS NULL OR rolpassword LIKE 'md5%' OR rolvaliduntil < now())
ORDER BY rolsuper DESC, rolname;`, run: true },
  related: ['security-ssl-tls', 'security-hardening-checklist', 'roles-permissions', 'fundamentals'],
  quiz: [
    { type: 'mcq', q: 'Which pg_hba.conf field order is correct?', options: ['DATABASE USER TYPE ADDRESS METHOD', 'TYPE DATABASE USER ADDRESS METHOD', 'TYPE USER DATABASE METHOD ADDRESS', 'METHOD TYPE DATABASE USER ADDRESS'], answer: 1, explain: 'TYPE DATABASE USER ADDRESS METHOD [OPTIONS].' },
    { type: 'predict', q: 'A client from 10.0.0.5 connects as app. Which method applies?', code: `host all all 10.0.0.0/8 trust
host all app 10.0.0.0/8 scram-sha-256`, options: ['scram-sha-256', 'trust', 'reject', 'Both are tried'], answer: 1, explain: 'First match wins - the trust line matches first.' },
    { type: 'tf', q: 'Changing password_encryption to scram-sha-256 automatically re-hashes existing md5 passwords.', answer: false, explain: 'Only newly set passwords use the new scheme.' },
    { type: 'mcq', q: 'Which method is deprecated in PostgreSQL 18?', options: ['scram-sha-256', 'peer', 'md5', 'cert'], answer: 2, explain: 'md5 password authentication is deprecated and emits warnings in PG18.' },
    { type: 'bug', q: 'Why are clients still connecting without TLS?', code: `host  app_db  app_rw  10.20.0.0/16  scram-sha-256`, options: ['Needs md5', 'TYPE host allows non-TLS TCP; use hostssl', 'Wrong CIDR', 'scram requires cert'], answer: 1, explain: 'host matches both SSL and non-SSL TCP connections.' }
  ]
},
/* ------------------------------------------------------------------ */
{
  id: 'security-ssl-tls',
  module: 'security',
  title: 'SSL/TLS: Encrypting Connections, hostssl and sslmode=verify-full',
  level: 4,
  minutes: 20,
  summary: 'Turn on TLS with ssl=on and certificates, force it with hostssl, and make clients verify the server with sslmode=verify-full.',
  objectives: [
    'Enable TLS on the server (ssl, ssl_cert_file, ssl_key_file, ssl_min_protocol_version)',
    'Require TLS per rule with hostssl and optionally client certificates (clientcert=verify-full / cert)',
    'Choose the right client sslmode and explain why require is not enough',
    'Audit which sessions use TLS with pg_stat_ssl',
    'Plan certificate rotation without downtime'
  ],
  concept: `<p>Without TLS, PostgreSQL traffic - queries, results, and for weak methods even passwords - crosses the network in plaintext. <span class="tag core">core</span> PostgreSQL supports TLS via OpenSSL: the server presents a certificate, the client verifies it (if told to), and both encrypt the session.</p>
<p><strong>Analogy - sending documents by courier.</strong> No TLS: postcards anyone can read. <code>sslmode=require</code>: a sealed envelope, but you hand it to whoever claims to be the courier (no ID check - a man-in-the-middle can impersonate the server). <code>sslmode=verify-full</code>: sealed envelope, and you check the courier's government ID (CA-signed certificate) <em>and</em> that the name on it matches the company you called (hostname).</p>
<h4>Server side</h4>
<ul>
<li><code>ssl = on</code>, <code>ssl_cert_file = 'server.crt'</code>, <code>ssl_key_file = 'server.key'</code> (key must be 0600, owned by postgres), optionally <code>ssl_ca_file</code> for client-certificate verification and <code>ssl_crl_file</code>.</li>
<li><code>ssl_min_protocol_version = 'TLSv1.2'</code> (default) or <code>TLSv1.3</code>; <code>ssl_ciphers</code> for TLS 1.2 suites.</li>
<li>These are <code>sighup</code> settings: <code>SELECT pg_reload_conf()</code> reloads certificates without restart (since PG10).</li>
<li><code>pg_hba.conf</code>: <code>hostssl</code> lines accept only TLS connections; add <code>clientcert=verify-full</code> to also demand a client certificate, or use the <code>cert</code> method to authenticate <em>by</em> certificate.</li>
</ul>
<h4>Client side: sslmode (libpq and most drivers)</h4>
<table>
<tr><th>sslmode</th><th>Encrypted?</th><th>Server verified?</th><th>Use</th></tr>
<tr><td>disable</td><td>No</td><td>No</td><td>Never in production</td></tr>
<tr><td>allow / prefer (default)</td><td>Maybe</td><td>No</td><td>Silently falls back to plaintext - avoid</td></tr>
<tr><td>require</td><td>Yes</td><td>No (unless root cert present)</td><td>Protects from passive sniffing only</td></tr>
<tr><td>verify-ca</td><td>Yes</td><td>CA chain</td><td>Private CA, hostname not checked</td></tr>
<tr><td><strong>verify-full</strong></td><td>Yes</td><td>CA chain + hostname</td><td><strong>Production default</strong></td></tr>
</table>
<p>PostgreSQL 17 added <code>sslnegotiation=direct</code> (TLS handshake immediately, ALPN, one less round trip). PostgreSQL 18 adds <code>ssl_tls13_ciphers</code> and <code>ssl_groups</code> for finer control.</p>`,
  why: `<p>Database traffic often crosses networks you do not fully control: cloud VPCs, cross-region replicas, VPNs, Kubernetes overlays. Compliance regimes (PCI DSS, HIPAA, ISO 27001, RBI/SEBI guidelines in India) require encryption in transit. And without server verification, an attacker on the path can impersonate the database and harvest credentials or alter results.</p>`,
  useCase: `<p>A payments company runs app servers in two availability zones connecting to a primary in a third. Their internal CA issues the server certificate with SAN <code>db-primary.payments.internal</code>; applications use <code>sslmode=verify-full sslrootcert=/etc/ssl/internal-ca.pem</code>. The replication user authenticates with the <code>cert</code> method using a client certificate. Certificates are rotated every 90 days by automation that writes new files and calls <code>pg_reload_conf()</code> - zero downtime, existing sessions keep their old TLS session.</p>`,
  internals: `<p>libpq sends an SSLRequest message on connect; if the server has <code>ssl = on</code> it replies 'S' and the TLS handshake begins (or, with PG17 <code>sslnegotiation=direct</code>, the client starts TLS immediately). After the handshake, the normal startup/authentication flow runs inside the encrypted channel. With SCRAM over TLS, <em>channel binding</em> (<code>scram-sha-256-plus</code>, client option <code>channel_binding=require</code>) ties authentication to the TLS session, defeating MITM even if a rogue certificate were accepted. <code>pg_stat_ssl</code> exposes per-backend TLS version, cipher and client certificate DN. TLS adds CPU for handshakes and a few percent for bulk encryption (AES-NI makes it cheap).</p>`,
  whenNot: `<ul><li>Local Unix-socket connections do not use TLS (and do not need it).</li>
<li>Do not terminate TLS on a load balancer and forward plaintext to PostgreSQL across an untrusted network.</li>
<li>Do not use self-signed certificates with <code>sslmode=require</code> and call it secure - use a CA (internal or public) and <code>verify-full</code>.</li></ul>`,
  syntax: `# postgresql.conf
ssl = on
ssl_cert_file = '/etc/postgresql/tls/server.crt'
ssl_key_file  = '/etc/postgresql/tls/server.key'
ssl_ca_file   = '/etc/postgresql/tls/root-ca.crt'     # to verify client certs
ssl_min_protocol_version = 'TLSv1.3'

# pg_hba.conf
hostssl  app_db  app_rw      10.20.0.0/16  scram-sha-256  clientcert=verify-full
hostssl  all     replicator  10.20.5.0/24  cert

# client connection string
postgresql://app_rw@db.internal:5432/app_db?sslmode=verify-full&sslrootcert=/etc/ssl/root-ca.crt&channel_binding=require`,
  examples: [
    { label: 'Basic', title: 'Check the server TLS configuration',
      sql: `SELECT name, setting, context
FROM   pg_settings
WHERE  name IN ('ssl', 'ssl_cert_file', 'ssl_key_file', 'ssl_ca_file',
                'ssl_min_protocol_version', 'ssl_ciphers')
ORDER  BY name;`,
      explain: `<p>All TLS settings have context <code>sighup</code>: change them in postgresql.conf (or <code>ALTER SYSTEM</code>) and reload, no restart needed. This embedded PGlite instance reports <code>ssl = off</code> because it has no network listener at all; a production server would show <code>on</code> with real certificate paths.</p>`,
      output: ` name                     | setting    | context
--------------------------+------------+---------
 ssl                      | off        | sighup
 ssl_ca_file              |            | sighup
 ssl_cert_file            | server.crt | sighup
 ssl_ciphers              | none       | sighup
 ssl_key_file             | server.key | sighup
 ssl_min_protocol_version | TLSv1.2    | sighup
(6 rows)`,
      run: true },
    { label: 'Intermediate', title: 'Audit sessions: who is connected without TLS?',
      sql: `SELECT a.pid, a.usename, a.client_addr, a.application_name,
       COALESCE(s.ssl, false) AS ssl,
       s.version AS tls_version, s.cipher, s.client_dn
FROM   pg_stat_activity a
LEFT   JOIN pg_stat_ssl s ON s.pid = a.pid
WHERE  a.backend_type = 'client backend'
ORDER  BY ssl, a.usename;`,
      explain: `<p><code>pg_stat_ssl</code> has one row per backend with TLS details; joining it to <code>pg_stat_activity</code> shows who is connected, from where, and whether the session is encrypted. Rows with <code>ssl = false</code> and a non-null <code>client_addr</code> are plaintext network sessions - fix them with <code>hostssl</code> rules. In this single-user in-browser database there are no network clients, so the result is usually empty.</p>`,
      output: ` pid | usename | client_addr | application_name | ssl | tls_version | cipher | client_dn
-----+---------+-------------+------------------+-----+-------------+--------+-----------
(0 rows)   -- on a real server: one row per session, e.g. app_rw | 10.20.3.7 | t | TLSv1.3 | TLS_AES_256_GCM_SHA384`,
      run: true },
    { label: 'Advanced', title: 'Issue certificates and enforce verify-full end to end',
      sql: `# 1) internal CA and server certificate (shell, on a secure admin host)
openssl req -new -x509 -days 3650 -nodes -subj "/CN=Corp DB Root CA" -keyout root-ca.key -out root-ca.crt
openssl req -new -nodes -subj "/CN=db-primary.corp.internal" -keyout server.key -out server.csr
openssl x509 -req -in server.csr -days 90 -CA root-ca.crt -CAkey root-ca.key -CAcreateserial \\
        -extfile <(printf "subjectAltName=DNS:db-primary.corp.internal") -out server.crt
chmod 600 server.key && chown postgres:postgres server.key

# 2) postgresql.conf
ssl = on
ssl_cert_file = 'server.crt'
ssl_key_file  = 'server.key'
ssl_min_protocol_version = 'TLSv1.3'

# 3) pg_hba.conf - TLS mandatory for TCP
hostssl  app_db  app_rw  10.20.0.0/16  scram-sha-256
host     all     all     0.0.0.0/0     reject

# 4) reload (SQL)
SELECT pg_reload_conf();

# 5) client
psql "host=db-primary.corp.internal dbname=app_db user=app_rw sslmode=verify-full sslrootcert=root-ca.crt channel_binding=require"`,
      explain: `<p>The full chain: a CA you control signs a server certificate whose SAN matches the hostname clients use; PostgreSQL loads it with <code>ssl = on</code>; <code>hostssl</code> + catch-all <code>reject</code> make plaintext TCP impossible; clients pin the CA with <code>sslrootcert</code> and check the hostname with <code>verify-full</code>; <code>channel_binding=require</code> binds SCRAM to the TLS session. Managed services (RDS, Cloud SQL, Azure) provide CA bundles - you still must set <code>verify-full</code> on the client.</p>`,
      output: `SSL connection (protocol: TLSv1.3, cipher: TLS_AES_256_GCM_SHA384, compression: off, ALPN: postgresql)
app_db=>`,
      run: false }
  ],
  compare: {
    bad: { sql: `# client: encryption without identity check
postgresql://app_rw@db.internal/app_db?sslmode=require
# or worse, the default:
postgresql://app_rw@db.internal/app_db            # sslmode=prefer -> may silently use plaintext`, why: 'require encrypts but does not verify who is on the other end (MITM possible); prefer silently downgrades to plaintext if the server or an attacker refuses TLS.', run: false },
    good: { sql: `postgresql://app_rw@db.internal/app_db?sslmode=verify-full&sslrootcert=/etc/ssl/corp-root-ca.crt&channel_binding=require`, why: 'verify-full validates the CA chain and the hostname; channel binding ties SCRAM authentication to this TLS session.', run: false }
  },
  mistakes: [
    'Enabling <code>ssl = on</code> but leaving <code>host</code> rules - clients may still connect in plaintext.',
    'Clients on the default <code>sslmode=prefer</code> - silent fallback to plaintext.',
    'Using <code>sslmode=require</code> with self-signed certs and believing MITM is prevented.',
    'Server key file readable by others - PostgreSQL refuses to start TLS ("private key file has group or world access").',
    'Certificate SAN does not include the hostname clients use (e.g. a DNS alias or load balancer name) - verify-full fails.',
    'Letting certificates expire - schedule rotation and reload.'
  ],
  best: [
    'Server: <code>ssl = on</code>, TLS 1.2+ (prefer 1.3), certificates from a managed CA, automated rotation + <code>pg_reload_conf()</code>.',
    'pg_hba.conf: only <code>hostssl</code> for TCP, explicit <code>reject</code> catch-all.',
    'Clients: <code>sslmode=verify-full</code> with a pinned root CA; <code>channel_binding=require</code> with SCRAM.',
    'Service accounts: consider certificate authentication (<code>cert</code>) or <code>clientcert=verify-full</code>.',
    'Monitor <code>pg_stat_ssl</code> for non-TLS sessions and certificate expiry dates.'
  ],
  performance: `<p>TLS handshakes cost a few milliseconds of CPU per connection (RSA/ECDHE); with connection pooling this is amortised. Bulk encryption with AES-GCM on CPUs with AES-NI costs low single-digit percent throughput. TLS 1.3 and PG17 direct negotiation save round trips on connect. Compression over TLS is disabled (CRIME attacks) - do not expect it.</p>`,
  security: `<p>TLS protects data in transit only; combine with encryption at rest (disk/volume encryption, or column-level encryption with pgcrypto <span class="tag ext">extension</span> for specific fields), strict authentication and least privilege. Protect private keys like passwords (0600, secret managers), and revoke compromised certificates via CRLs.</p>`,
  scenario: { title: 'Compliance audit: "prove all database connections are encrypted"', steps: [
    '1. Query pg_stat_ssl joined with pg_stat_activity to list current non-TLS network sessions.',
    '2. Replace host with hostssl for every TCP rule and add catch-all reject lines; reload.',
    '3. Switch all client connection strings to sslmode=verify-full with the CA bundle.',
    '4. Set ssl_min_protocol_version = TLSv1.2 or 1.3; reload.',
    '5. Keep a scheduled check that alerts if any client backend shows ssl = false.'
  ] },
  widgets: ['diagram:client-server', 'lab:security'],
  interview: [
    { q: 'Difference between sslmode=require and verify-full?', a: 'require encrypts the connection but does not authenticate the server, so a man-in-the-middle with any certificate can intercept it. verify-full checks that the server certificate chains to a trusted CA and that its hostname matches the one you connected to, preventing impersonation.' },
    { q: 'How do you force TLS for all remote connections?', a: 'Enable ssl in postgresql.conf with valid certificates, use hostssl instead of host for every TCP rule in pg_hba.conf, and add catch-all host ... reject lines so non-TLS TCP connections never match an accepting rule. Then verify with pg_stat_ssl.' },
    { q: 'Can you rotate server certificates without downtime?', a: 'Yes. Since PostgreSQL 10 the TLS settings are reloadable: replace the certificate and key files and run SELECT pg_reload_conf(). New connections use the new certificate; existing sessions continue on their established TLS sessions.' }
  ],
  exercises: [
    { task: 'Show whether the current session is using TLS.',
      solution: `SELECT pid, ssl, version, cipher
FROM pg_stat_ssl
WHERE pid = pg_backend_pid();`, run: true },
    { task: 'Write the pg_hba.conf line that authenticates the role replicator by client certificate, from 10.20.5.11 only, for replication connections.',
      solution: `hostssl  replication  replicator  10.20.5.11/32  cert`, run: false }
  ],
  challenge: { task: 'Write a monitoring query returning the count of client backends per (usename, ssl) pair, flagging any non-TLS session that has a client address (network connection).',
    hint: 'LEFT JOIN pg_stat_ssl, GROUP BY, bool_or over client_addr IS NOT NULL.',
    solution: `SELECT a.usename,
       COALESCE(s.ssl, false) AS ssl,
       count(*) AS sessions,
       bool_or(a.client_addr IS NOT NULL AND NOT COALESCE(s.ssl, false)) AS plaintext_network_session
FROM pg_stat_activity a
LEFT JOIN pg_stat_ssl s ON s.pid = a.pid
WHERE a.backend_type = 'client backend'
GROUP BY a.usename, COALESCE(s.ssl, false)
ORDER BY plaintext_network_session DESC, a.usename;`, run: true },
  related: ['security-authentication-pg-hba', 'security-hardening-checklist', 'replication', 'security'],
  quiz: [
    { type: 'mcq', q: 'Which client sslmode verifies both the CA chain and hostname?', options: ['require', 'verify-ca', 'verify-full', 'prefer'], answer: 2, explain: 'verify-full checks the chain and the hostname.' },
    { type: 'tf', q: 'A pg_hba.conf line of type host only accepts TLS connections.', answer: false, explain: 'host accepts both; hostssl accepts only TLS.' },
    { type: 'mcq', q: 'What is the default libpq sslmode?', options: ['disable', 'prefer', 'require', 'verify-full'], answer: 1, explain: 'prefer - tries TLS but silently falls back to plaintext.' },
    { type: 'scenario', q: 'Certificates expire next week. How to rotate with no downtime?', options: ['Restart PostgreSQL at night', 'Replace cert/key files and SELECT pg_reload_conf()', 'Disable ssl temporarily', 'Use sslmode=disable during rotation'], answer: 1, explain: 'TLS settings are reloadable since PostgreSQL 10.' }
  ]
},
/* ------------------------------------------------------------------ */
{
  id: 'security-hardening-checklist',
  module: 'security',
  title: 'Hardening Checklist: Least Privilege, public Schema, Superusers, pgaudit, SQL Injection',
  level: 4,
  minutes: 28,
  summary: 'A production hardening checklist: minimise superusers, lock down the public schema (PG15 change), limit network exposure, audit with pgaudit, manage secrets, and prevent SQL injection with parameters.',
  objectives: [
    'Apply least privilege to roles, databases and schemas',
    'Explain the PostgreSQL 15 public-schema change and lock down older databases',
    'Find and remove unnecessary superuser and dangerous privileges',
    'Restrict network exposure with listen_addresses, firewalls and pg_hba.conf',
    'Configure audit logging with pgaudit (extension) and core logging',
    'Prevent SQL injection with parameterized queries and safe dynamic SQL'
  ],
  concept: `<p>Hardening is about shrinking the <strong>blast radius</strong>: assume a credential leaks or an application has a bug, and make sure the damage is small, visible and recoverable.</p>
<p><strong>Analogy - a hotel.</strong> Guests get key cards that open only their room and the gym (least privilege); cleaning staff can enter rooms but not the safe; only the manager has the master key and it stays in a locked office (superuser used rarely, not by apps); CCTV records corridors (audit logs); the front door is not left propped open to the street (network exposure); and the receptionist never lets a guest write their own instructions on the room-allocation form (SQL injection).</p>
<h4>The checklist</h4>
<ol>
<li><strong>Superusers</strong>: only <code>postgres</code> (or a break-glass DBA role). Applications never connect as superuser - superusers bypass all permission checks and RLS, can read server files (<code>pg_read_file</code>) and run OS commands (<code>COPY ... PROGRAM</code>).</li>
<li><strong>Roles</strong>: owner role (NOLOGIN, owns schema objects), app role (DML only), read-only role; no <code>CREATEROLE</code>/<code>CREATEDB</code>/<code>BYPASSRLS</code> for apps. Use predefined roles (<code>pg_monitor</code>, <code>pg_read_all_data</code>, <code>pg_signal_backend</code>) instead of superuser for ops tasks.</li>
<li><strong>public schema</strong>: since <strong>PostgreSQL 15</strong>, <code>PUBLIC</code> no longer has <code>CREATE</code> on the <code>public</code> schema in new databases, and the schema is owned by <code>pg_database_owner</code>. Databases upgraded from PG14 or earlier keep the old, insecure default - run <code>REVOKE CREATE ON SCHEMA public FROM PUBLIC</code>. Also consider <code>REVOKE ALL ON DATABASE db FROM PUBLIC</code> and granting <code>CONNECT</code> explicitly.</li>
<li><strong>Network</strong>: <code>listen_addresses</code> limited to private interfaces, firewall/security groups allowing only app subnets, <code>hostssl</code> + SCRAM, catch-all <code>reject</code>, never expose 5432 to the internet.</li>
<li><strong>Auditing</strong>: core logging (<code>log_connections</code>, <code>log_disconnections</code>, <code>log_statement = 'ddl'</code>, <code>log_line_prefix</code> with user/db/app/client) plus <span class="tag ext">extension</span> <strong>pgaudit</strong> for structured session/object audit logs (e.g. <code>pgaudit.log = 'ddl, role, write'</code>). pgaudit must be in <code>shared_preload_libraries</code>.</li>
<li><strong>Secrets</strong>: no passwords in code or Git; use a secret manager (Vault, AWS Secrets Manager, Azure Key Vault), short-lived credentials (IAM auth on RDS, Vault dynamic roles), <code>.pgpass</code> with 0600 for humans; never log bind parameters containing secrets.</li>
<li><strong>SQL injection</strong>: always use bind parameters (<code>$1</code>) / prepared statements; in PL/pgSQL dynamic SQL use <code>format('%I', ident)</code> for identifiers, <code>%L</code> or <code>EXECUTE ... USING</code> for values; set <code>search_path</code> on <code>SECURITY DEFINER</code> functions.</li>
<li><strong>Updates and extensions</strong>: apply minor releases promptly (security fixes), install only needed extensions, restrict untrusted languages (<code>plpython3u</code> etc.) to superusers.</li>
<li><strong>Data at rest and backups</strong>: encrypted volumes, encrypted and access-controlled backups, column encryption (pgcrypto) for especially sensitive fields.</li>
</ol>`,
  why: `<p>Most real-world database breaches are not exotic exploits: they are exposed ports with weak authentication, applications connecting as superuser, leaked credentials in Git, and SQL injection. Each checklist item closes one of these doors, and together they turn a would-be total compromise into a contained incident.</p>`,
  useCase: `<p>A healthcare SaaS passing a SOC 2 audit: the app connects as <code>app_rw</code> (no DDL, no superuser) through PgBouncer; migrations run as <code>app_owner</code> from CI only; analysts use <code>app_ro</code> with column-level grants excluding patient identifiers; pgaudit logs all DDL and role changes plus reads of the <code>patients</code> table (object audit via an audit role); logs ship to a SIEM. A pen-test SQL injection attempt on a search endpoint failed because every query used bind parameters, and the app role could not read <code>pg_authid</code> or run <code>COPY ... PROGRAM</code> even if injection had succeeded.</p>`,
  internals: `<p>Privilege checks happen in the executor (ACL checks on each relation, column, function and schema used) using the <code>relacl</code>/<code>nspacl</code>/<code>proacl</code> arrays you see in catalogs; superusers skip them. Name resolution uses <code>search_path</code>; if an attacker can CREATE in a schema earlier on another user's path, they can plant a function or operator that shadows a built-in - that is why the PG15 public-schema change (and <code>SET search_path</code> on SECURITY DEFINER functions) matters (CVE-2018-1058 class). pgaudit hooks into the executor and utility processing to emit <code>AUDIT:</code> log lines with statement class, object and statement text.</p>`,
  whenNot: `<ul><li>Do not "fix" permission errors by granting superuser or <code>ALL PRIVILEGES</code> - find the exact privilege needed.</li>
<li>Do not enable <code>log_statement = 'all'</code> or pgaudit <code>read</code> on every table in high-traffic systems without capacity planning - log volume can hurt performance and leak data into logs.</li>
<li>Do not rely on application-side escaping functions instead of bind parameters.</li></ul>`,
  syntax: `-- network & auth (postgresql.conf)
listen_addresses = '10.20.1.15'          -- not '*'
password_encryption = 'scram-sha-256'
shared_preload_libraries = 'pgaudit'     -- restart required
pgaudit.log = 'ddl, role, write'
log_connections = on                     -- PG18 also accepts a list, e.g. 'receipt,authentication,authorization'
log_line_prefix = '%m [%p] %q%u@%d app=%a client=%h '

-- SQL
REVOKE CREATE ON SCHEMA public FROM PUBLIC;          -- default since PG15 for new DBs
REVOKE ALL ON DATABASE app_db FROM PUBLIC;
GRANT CONNECT ON DATABASE app_db TO app_rw, app_ro;
ALTER ROLE some_app NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS;
CREATE EXTENSION pgaudit;`,
  examples: [
    { label: 'Basic', title: 'Find powerful roles',
      sql: `SELECT rolname,
       rolsuper       AS superuser,
       rolcreaterole  AS create_role,
       rolcreatedb    AS create_db,
       rolbypassrls   AS bypass_rls,
       rolreplication AS replication,
       rolcanlogin    AS can_login
FROM   pg_roles
WHERE  rolname !~ '^pg_'
  AND  (rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls OR rolreplication)
ORDER  BY rolsuper DESC, rolname;`,
      explain: `<p>Every role in this list can escalate or bypass controls: superusers bypass everything, <code>CREATEROLE</code> can create and manage roles (since PG16 limited to roles it administers, but still powerful), <code>BYPASSRLS</code> ignores row-level security, <code>REPLICATION</code> can stream the entire cluster's data. In production the list should contain only the bootstrap superuser and a few dedicated operational roles. Here only <code>postgres</code> appears.</p>`,
      output: ` rolname  | superuser | create_role | create_db | bypass_rls | replication | can_login
----------+-----------+-------------+-----------+------------+-------------+-----------
 postgres | t         | t           | t         | t          | t           | t
(1 row)`,
      run: true },
    { label: 'Intermediate', title: 'Lock down the public schema and database CONNECT',
      sql: `-- what does PUBLIC (every role) get today?
SELECT nspname, nspowner::regrole AS owner, nspacl
FROM   pg_namespace WHERE nspname = 'public';

CREATE ROLE intern LOGIN;
SELECT has_schema_privilege('intern', 'public', 'CREATE')  AS can_create_in_public,
       has_database_privilege('intern', current_database(), 'CONNECT') AS can_connect;

-- PG14-and-earlier databases: remove CREATE from PUBLIC explicitly (no-op on PG15+ defaults)
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- only explicitly granted roles may connect to this database
DO $$ BEGIN
  EXECUTE format('REVOKE CONNECT, TEMPORARY ON DATABASE %I FROM PUBLIC', current_database());
END $$;

SELECT has_schema_privilege('intern', 'public', 'CREATE')  AS can_create_in_public,
       has_database_privilege('intern', current_database(), 'CONNECT') AS can_connect;`,
      explain: `<p><code>nspacl</code> shows <code>pg_database_owner=UC/pg_database_owner</code> and <code>=U/pg_database_owner</code>: since PG15, <code>PUBLIC</code> (the empty grantee) has only USAGE on <code>public</code>, not CREATE. Upgraded clusters may still show <code>=UC</code> - the REVOKE fixes it. By default <code>PUBLIC</code> can CONNECT to every database and create temp tables; revoking that means a new login role cannot even connect until granted. The DO block uses <code>format('%I', ...)</code> to quote the database name safely.</p>`,
      output: ` nspname | owner             | nspacl
---------+-------------------+------------------------------------------------------
 public  | pg_database_owner | {pg_database_owner=UC/pg_database_owner,=U/pg_database_owner}
(1 row)

 can_create_in_public | can_connect
----------------------+-------------
 f                    | t
(1 row)

 can_create_in_public | can_connect
----------------------+-------------
 f                    | f
(1 row)`,
      run: true },
    { label: 'Advanced', title: 'SQL injection: concatenation vs parameters vs safe dynamic SQL',
      sql: `-- 1) prepared statement: the value is data, never SQL
PREPARE find_user_by_name(text) AS
  SELECT id, username, role FROM users WHERE username = $1;
EXECUTE find_user_by_name('user5');
EXECUTE find_user_by_name($$x' OR '1'='1$$);       -- injection attempt: matches nothing
DEALLOCATE find_user_by_name;

-- 2) dynamic SQL in PL/pgSQL done safely: %I for identifiers, USING for values
CREATE FUNCTION count_rows_where(p_table text, p_column text, p_value text)
RETURNS bigint LANGUAGE plpgsql STABLE
SET search_path = public, pg_temp AS $$
DECLARE n bigint;
BEGIN
  EXECUTE format('SELECT count(*) FROM %I WHERE %I = $1', p_table, p_column)
     INTO n USING p_value;
  RETURN n;
END $$;

SELECT count_rows_where('users', 'role', 'admin')               AS admins,
       count_rows_where('users', 'role', $$x' OR '1'='1$$)        AS injection_attempt;`,
      explain: `<p>With a bind parameter (<code>$1</code>), the attacker's string <code>x' OR '1'='1</code> is compared literally as a username, so nothing matches - the query structure cannot change. Application drivers do the same with placeholders (<code>?</code>, <code>%s</code>, <code>@p</code>, <code>$1</code>) when you pass values separately. For dynamic identifiers, <code>format('%I')</code> double-quotes them, and <code>EXECUTE ... USING</code> passes values as parameters. <code>SET search_path</code> on the function prevents search-path hijacking. The <code>DEALLOCATE</code> removes the session-level prepared statement.</p>`,
      output: ` id | username | role
----+----------+-------
  5 | user5    | admin
(1 row)

 id | username | role
----+----------+------
(0 rows)

 admins | injection_attempt
--------+-------------------
     12 |                 0
(1 row)`,
      run: true }
  ],
  compare: {
    bad: { sql: `-- dynamic SQL built by string concatenation (injectable)
CREATE FUNCTION find_users_bad(p_name text) RETURNS SETOF users LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY EXECUTE 'SELECT * FROM users WHERE username = ''' || p_name || '''';
END $$;
-- attacker input returns EVERY user
SELECT count(*) AS rows_leaked FROM find_users_bad($$x' OR '1'='1$$);`, why: 'Concatenating user input into SQL lets the input change the query: the OR 1=1 payload returns all 60 users. The same flaw in application code is the classic SQL injection.', run: true },
    good: { sql: `CREATE FUNCTION find_users_good(p_name text) RETURNS SETOF users LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY EXECUTE 'SELECT * FROM users WHERE username = $1' USING p_name;
END $$;
SELECT count(*) AS rows_leaked FROM find_users_good($$x' OR '1'='1$$);`, why: 'EXECUTE ... USING passes the value as a parameter; the payload is just an unusual username and matches nothing.', run: true }
  },
  mistakes: [
    'Applications connecting as <code>postgres</code> (superuser) "because permissions were annoying".',
    'Upgrading from PG14 or earlier and assuming the PG15 public-schema defaults apply - they do not to existing databases.',
    '<code>listen_addresses = \'*\'</code> plus a cloud security group open to 0.0.0.0/0 on port 5432.',
    'Building SQL with string concatenation or <code>quote_literal</code> in application code instead of bind parameters.',
    '<code>SECURITY DEFINER</code> functions without <code>SET search_path</code> - privilege escalation via shadowed objects.',
    'Passwords in connection strings committed to Git or printed in logs.'
  ],
  best: [
    'Separate owner, read-write and read-only roles; apps never own objects or have superuser/CREATEROLE/BYPASSRLS.',
    'Revoke CREATE on <code>public</code> and CONNECT on databases from PUBLIC; grant explicitly.',
    'Bind PostgreSQL to private interfaces; firewall to app subnets; <code>hostssl</code> + SCRAM; catch-all reject.',
    'Enable connection/DDL logging and pgaudit for regulated data; ship logs off-host.',
    'Use bind parameters everywhere; <code>format(\'%I\', ...)</code> and <code>USING</code> for dynamic SQL.',
    'Patch minor versions promptly and review installed extensions and untrusted languages.'
  ],
  performance: `<p>Most hardening has negligible runtime cost. Exceptions: verbose logging (<code>log_statement = 'all'</code>, pgaudit read logging on hot tables) can add significant I/O - log what compliance needs, use object-level pgaudit for sensitive tables only. Prepared statements also <em>improve</em> performance by reusing plans (watch generic vs custom plans via <code>plan_cache_mode</code>). RLS policies add per-row predicates - index the columns they use.</p>`,
  security: `<p>This whole lesson is the security discussion. Remember the order of defences: network (can they reach it?), authentication (who are they?), authorisation (what may they do? GRANTs, RLS), auditing (what did they do?), and recovery (encrypted, tested backups). pgaudit <span class="tag ext">extension</span> is not part of core and must be installed and preloaded.</p>`,
  scenario: { title: 'Post-incident: an attacker ran COPY ... TO PROGRAM through a web app', steps: [
    '1. Root cause: the app connected as a superuser and had a SQL injection bug - two failures combined.',
    '2. Immediately rotate credentials; restrict network access; review logs (and pgaudit, if enabled) for executed statements.',
    '3. Create app_owner/app_rw/app_ro roles; transfer ownership; the app reconnects as app_rw (no superuser, no pg_execute_server_program).',
    '4. Fix the injection with bind parameters; add a code-scan rule banning string-built SQL.',
    '5. Add pgaudit (ddl, role, write) and alerts for superuser logins, then schedule a quarterly privilege review.'
  ] },
  widgets: ['lab:security'],
  interview: [
    { q: 'What changed about the public schema in PostgreSQL 15?', a: 'New databases no longer grant CREATE on the public schema to PUBLIC, and the schema is owned by pg_database_owner. Ordinary users can still use objects there but cannot create new ones. Databases upgraded from older versions keep the old ACL, so you must REVOKE CREATE ON SCHEMA public FROM PUBLIC yourself.' },
    { q: 'Why should applications never connect as superuser?', a: 'A superuser bypasses all privilege checks and RLS, can read and write server files, run OS commands via COPY PROGRAM or untrusted languages, and alter any configuration. Any application bug such as SQL injection then becomes full server compromise. Applications should use a least-privilege role with only the DML they need.' },
    { q: 'How do you prevent SQL injection in PostgreSQL applications?', a: 'Always send values as bind parameters through the driver or PREPARE/EXECUTE so they are never parsed as SQL. For dynamic SQL in PL/pgSQL use format with %I for identifiers and EXECUTE ... USING for values, validate identifiers against an allow-list, and give the application role minimal privileges to limit damage.' },
    { q: 'What is pgaudit and how is it enabled?', a: 'pgaudit is an extension that writes detailed audit records (session or object level) to the PostgreSQL log, classified as READ, WRITE, DDL, ROLE, FUNCTION, MISC. It is enabled by adding pgaudit to shared_preload_libraries (restart), CREATE EXTENSION pgaudit, and configuring pgaudit.log, e.g. ddl, role, write.' }
  ],
  exercises: [
    { task: 'Check whether PUBLIC can create objects in the public schema of this database.',
      solution: `SELECT has_schema_privilege('public', 'public', 'CREATE') AS public_can_create;`, run: true },
    { task: 'List the members of the most dangerous predefined roles (pg_execute_server_program, pg_read_server_files, pg_write_server_files).',
      solution: `SELECT r.rolname AS predefined_role, m.rolname AS member
FROM pg_auth_members am
JOIN pg_roles r ON r.oid = am.roleid
JOIN pg_roles m ON m.oid = am.member
WHERE r.rolname IN ('pg_execute_server_program', 'pg_read_server_files', 'pg_write_server_files')
ORDER BY 1, 2;`, run: true },
    { task: 'Write the postgresql.conf lines to enable pgaudit for DDL, role changes and writes, with connection logging.',
      solution: `shared_preload_libraries = 'pgaudit'      # restart required
pgaudit.log = 'ddl, role, write'
pgaudit.log_relation = on
log_connections = on
log_disconnections = on
log_line_prefix = '%m [%p] %q%u@%d app=%a client=%h '
-- then, in each database: CREATE EXTENSION pgaudit;`, run: false }
  ],
  challenge: { task: 'Write a SECURITY DEFINER function that lets a low-privilege role look up a user\'s role by username without SELECT on the users table, safely (fixed search_path, parameterized, EXECUTE revoked from PUBLIC), and test it with SET ROLE.',
    hint: 'CREATE FUNCTION ... SECURITY DEFINER SET search_path = public, pg_temp; REVOKE EXECUTE ... FROM PUBLIC; GRANT EXECUTE TO the role.',
    solution: `CREATE ROLE helpdesk NOLOGIN;
CREATE FUNCTION lookup_user_role(p_username text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$ SELECT role FROM users WHERE username = p_username $$;
REVOKE EXECUTE ON FUNCTION lookup_user_role(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lookup_user_role(text) TO helpdesk;
SET ROLE helpdesk;
SELECT lookup_user_role('user5') AS role_of_user5;
RESET ROLE;`, run: true },
  related: ['security-authentication-pg-hba', 'roles-permissions-least-privilege', 'row-level-security', 'functions'],
  quiz: [
    { type: 'tf', q: 'In a new PostgreSQL 16 database, any role can create tables in the public schema by default.', answer: false, explain: 'Since PG15, PUBLIC has only USAGE on public in new databases.' },
    { type: 'mcq', q: 'Safest way to include a user-supplied value in PL/pgSQL dynamic SQL?', options: ['Concatenate with ||', 'quote_ident(value)', 'EXECUTE ... USING value', 'replace quotes manually'], answer: 2, explain: 'USING passes the value as a parameter; quote_ident is for identifiers.' },
    { type: 'mcq', q: 'pgaudit is...', options: ['A core GUC', 'An extension loaded via shared_preload_libraries', 'A psql meta-command', 'A predefined role'], answer: 1, explain: 'pgaudit is an extension that must be preloaded.' },
    { type: 'bug', q: 'What is the security bug?', code: `CREATE FUNCTION admin_reset(u text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN EXECUTE 'UPDATE users SET is_active = false WHERE username = ''' || u || ''''; END $$;`, options: ['Missing RETURNS TABLE', 'SQL injection via concatenation and no SET search_path on a SECURITY DEFINER function', 'plpgsql cannot UPDATE', 'Needs VOLATILE'], answer: 1, explain: 'Use EXECUTE ... USING and set search_path; also revoke EXECUTE from PUBLIC.' },
    { type: 'scenario', q: 'Monitoring tool needs to read pg_stat_* views. Grant?', options: ['SUPERUSER', 'pg_monitor', 'pg_write_all_data', 'CREATEROLE'], answer: 1, explain: 'pg_monitor gives read access to monitoring views and functions without superuser.' }
  ]
}
]);

PGM.addLessons([
/* ------------------------------------------------------------------ */
{
  id: 'roles-permissions-roles-users',
  module: 'roles-permissions',
  title: 'Roles & Users: Attributes, Group Membership and Predefined Roles',
  level: 4,
  minutes: 24,
  summary: 'In PostgreSQL every user and group is a role: learn LOGIN/NOLOGIN, SUPERUSER, CREATEDB, CREATEROLE, INHERIT, membership options and predefined roles like pg_read_all_data and pg_monitor.',
  objectives: [
    'Create roles and users with the right attributes (LOGIN, CREATEDB, CREATEROLE, CONNECTION LIMIT, VALID UNTIL)',
    'Build group roles and grant membership with INHERIT / SET / ADMIN options (PG16+)',
    'Explain inheritance vs SET ROLE and session_user vs current_user',
    'Use predefined roles instead of superuser for monitoring and bulk read/write',
    'Inspect roles and memberships in pg_roles and pg_auth_members',
    'Avoid dangerous attributes on application roles'
  ],
  concept: `<p>PostgreSQL has a single concept, the <strong>role</strong>, for both users and groups. <code>CREATE USER</code> is just <code>CREATE ROLE ... LOGIN</code>. A role can own objects, hold privileges, log in (if it has <code>LOGIN</code>), and be a member of other roles. Roles are <em>cluster-wide</em>: the same role exists in every database of the cluster, while privileges are granted per object.</p>
<p><strong>Analogy - an office badge system.</strong> A badge (role with LOGIN) gets you through the door. Team badges like "Finance" (group roles, NOLOGIN) are never used to enter the building - instead your personal badge is <em>linked</em> to the Finance team and inherits its door access. The building manager's master badge (SUPERUSER) opens everything and must stay in the safe.</p>
<h4>Role attributes</h4>
<table>
<tr><th>Attribute</th><th>Meaning</th><th>Give to apps?</th></tr>
<tr><td><code>LOGIN</code> / <code>NOLOGIN</code></td><td>Can start a session</td><td>LOGIN for the app user; groups are NOLOGIN</td></tr>
<tr><td><code>SUPERUSER</code></td><td>Bypasses all checks (and RLS)</td><td>Never</td></tr>
<tr><td><code>CREATEDB</code></td><td>Can create databases</td><td>No</td></tr>
<tr><td><code>CREATEROLE</code></td><td>Can create roles; since PG16 only manages roles it has ADMIN on</td><td>No (only a dedicated user-admin role)</td></tr>
<tr><td><code>INHERIT</code> (default) / <code>NOINHERIT</code></td><td>Default for whether new memberships inherit privileges</td><td>Default is fine</td></tr>
<tr><td><code>REPLICATION</code></td><td>Can start streaming replication / create slots</td><td>Only replication users</td></tr>
<tr><td><code>BYPASSRLS</code></td><td>Ignores row-level security</td><td>Never for tenant-facing apps</td></tr>
<tr><td><code>CONNECTION LIMIT n</code>, <code>VALID UNTIL ts</code>, <code>PASSWORD</code></td><td>Limits and credentials</td><td>Yes, sensible limits</td></tr>
</table>
<h4>Membership (group roles)</h4>
<p><code>GRANT analysts TO alice;</code> makes alice a member. Since <strong>PostgreSQL 16</strong> each membership has three options:</p>
<ul>
<li><code>INHERIT</code> - alice automatically uses analysts' privileges (default follows alice's INHERIT attribute).</li>
<li><code>SET</code> - alice may <code>SET ROLE analysts</code> to act as it (e.g. to create objects owned by it).</li>
<li><code>ADMIN</code> - alice may grant/revoke membership in analysts to others.</li>
</ul>
<p><code>session_user</code> is who logged in; <code>current_user</code> is whose privileges are being used right now (changed by <code>SET ROLE</code> or SECURITY DEFINER functions).</p>
<h4>Predefined roles (built in)</h4>
<ul>
<li><code>pg_read_all_data</code> / <code>pg_write_all_data</code> - SELECT / INSERT-UPDATE-DELETE on all tables (PG14+), ignoring object ACLs (not RLS).</li>
<li><code>pg_monitor</code> (includes <code>pg_read_all_settings</code>, <code>pg_read_all_stats</code>, <code>pg_stat_scan_tables</code>) - for monitoring agents.</li>
<li><code>pg_signal_backend</code> - cancel/terminate non-superuser sessions.</li>
<li><code>pg_checkpoint</code> (PG15), <code>pg_maintain</code> (PG17: VACUUM, ANALYZE, REINDEX, REFRESH MATVIEW, CLUSTER, LOCK on all tables), <code>pg_create_subscription</code> (PG16), <code>pg_use_reserved_connections</code> (PG16).</li>
<li>Dangerous: <code>pg_read_server_files</code>, <code>pg_write_server_files</code>, <code>pg_execute_server_program</code> - effectively OS-level access.</li>
<li><code>pg_database_owner</code> - implicit member is the current database's owner (owns <code>public</code> since PG15).</li>
</ul>`,
  why: `<p>Granting privileges person-by-person does not scale and is impossible to audit. Group roles let you grant once to "analysts" and manage people by membership. Predefined roles let ops tools work without superuser - the most common unnecessary use of superuser is monitoring.</p>`,
  useCase: `<p>A retail analytics team of 40 people: one NOLOGIN group <code>analysts</code> has SELECT on the reporting schema; each analyst logs in with a personal LOGIN role (LDAP-authenticated) that is a member of <code>analysts</code>, so offboarding is a single <code>DROP ROLE</code>/<code>REVOKE</code>. Datadog connects as <code>monitoring</code> (member of <code>pg_monitor</code>, <code>CONNECTION LIMIT 5</code>). The nightly maintenance job runs as a role in <code>pg_maintain</code> (PG17) instead of superuser.</p>`,
  internals: `<p>Roles live in the shared catalog <code>pg_authid</code> (passwords visible only to superusers; <code>pg_roles</code> is the public view with the password masked). Memberships are rows in <code>pg_auth_members</code> (<code>roleid</code>, <code>member</code>, <code>grantor</code>, and since PG16 <code>admin_option</code>, <code>inherit_option</code>, <code>set_option</code>). Privilege checks compute the set of roles whose privileges <code>current_user</code> can use via inheritance chains; <code>pg_has_role(user, role, 'USAGE')</code> tests inheritance, <code>'MEMBER'</code> tests membership (including SET-only). Because roles are cluster-global, <code>DROP ROLE</code> fails while the role owns objects or holds privileges in any database - use <code>REASSIGN OWNED BY</code> and <code>DROP OWNED BY</code> in each database first.</p>`,
  whenNot: `<ul><li>Do not create one database role per end-user of a web application with millions of users - use an app role plus RLS with an application user id in a setting.</li>
<li>Do not grant privileges directly to personal login roles - grant to groups.</li>
<li>Do not use <code>SUPERUSER</code>, <code>BYPASSRLS</code> or the server-file predefined roles to "make it work".</li></ul>`,
  syntax: `CREATE ROLE name [ [ WITH ] option [ ... ] ];
  -- options: LOGIN | NOLOGIN | SUPERUSER | CREATEDB | CREATEROLE | INHERIT | NOINHERIT
  --          REPLICATION | BYPASSRLS | CONNECTION LIMIT n | PASSWORD 'pw' | VALID UNTIL 'ts'
CREATE USER name ...;                    -- same as CREATE ROLE name LOGIN ...
ALTER ROLE name WITH NOCREATEDB CONNECTION LIMIT 20;
GRANT group_role TO member_role [ WITH { INHERIT | SET | ADMIN } { TRUE | FALSE } [, ...] ];  -- PG16+
REVOKE group_role FROM member_role;
SET ROLE group_role;   RESET ROLE;
REASSIGN OWNED BY old_role TO new_role;  DROP OWNED BY old_role;  DROP ROLE old_role;`,
  examples: [
    { label: 'Basic', title: 'Create login and group roles with attributes',
      sql: `CREATE ROLE reporting NOLOGIN;                                  -- group role
CREATE ROLE asha LOGIN PASSWORD 'Asha#2025' CONNECTION LIMIT 5
            VALID UNTIL '2026-12-31';                           -- personal login role
CREATE USER etl_job PASSWORD 'Etl#2025';                        -- CREATE USER = CREATE ROLE ... LOGIN
CREATE ROLE dba_helper LOGIN CREATEDB;

SELECT rolname, rolcanlogin AS login, rolsuper AS super, rolcreatedb AS createdb,
       rolcreaterole AS createrole, rolinherit AS inherit, rolconnlimit AS conn_limit,
       rolvaliduntil IS NOT NULL AS expires
FROM   pg_roles
WHERE  rolname IN ('reporting', 'asha', 'etl_job', 'dba_helper')
ORDER  BY rolname;`,
      explain: `<p><code>reporting</code> cannot log in - it exists only to hold privileges. <code>asha</code> can log in, at most 5 concurrent sessions, and her password expires at the end of 2026. <code>CREATE USER</code> differs from <code>CREATE ROLE</code> only in defaulting to <code>LOGIN</code>. <code>pg_roles</code> is the safe public view of roles (passwords masked).</p>`,
      output: ` rolname    | login | super | createdb | createrole | inherit | conn_limit | expires
------------+-------+-------+----------+------------+---------+------------+---------
 asha       | t     | f     | f        | f          | t       |          5 | t
 dba_helper | t     | f     | t        | f          | t       |         -1 | f
 etl_job    | t     | f     | f        | f          | t       |         -1 | f
 reporting  | f     | f     | f        | f          | t       |         -1 | f
(4 rows)`,
      run: true },
    { label: 'Intermediate', title: 'Group membership: INHERIT vs SET (PostgreSQL 16+)',
      sql: `CREATE ROLE analysts NOLOGIN;
GRANT SELECT ON orders, customers TO analysts;

CREATE ROLE alice LOGIN;
CREATE ROLE bob   LOGIN;
GRANT analysts TO alice;                                   -- inherits automatically
GRANT analysts TO bob WITH INHERIT FALSE, SET TRUE;        -- must SET ROLE analysts explicitly

SELECT m.rolname AS member, r.rolname AS group_role,
       am.inherit_option, am.set_option, am.admin_option
FROM   pg_auth_members am
JOIN   pg_roles r ON r.oid = am.roleid
JOIN   pg_roles m ON m.oid = am.member
WHERE  r.rolname = 'analysts'
ORDER  BY member;

SELECT has_table_privilege('alice', 'orders', 'SELECT') AS alice_can_read,
       has_table_privilege('bob',   'orders', 'SELECT') AS bob_can_read_directly,
       pg_has_role('bob', 'analysts', 'MEMBER')          AS bob_is_member;`,
      explain: `<p>Privileges are granted once to the group. Alice's membership inherits, so she can read <code>orders</code> immediately. Bob's membership has <code>INHERIT FALSE, SET TRUE</code>: he is a member but must run <code>SET ROLE analysts</code> to use its privileges - useful for powerful roles you want people to "step into" deliberately (like sudo), which also makes the switch visible in logs.</p>`,
      output: ` member | group_role | inherit_option | set_option | admin_option
--------+------------+----------------+------------+--------------
 alice  | analysts   | t              | t          | f
 bob    | analysts   | f              | t          | f
(2 rows)

 alice_can_read | bob_can_read_directly | bob_is_member
----------------+-----------------------+---------------
 t              | f                     | t
(1 row)`,
      run: true },
    { label: 'Advanced', title: 'Predefined roles instead of superuser',
      sql: `CREATE ROLE bi_reader LOGIN;      -- read everything, write nothing
CREATE ROLE monitoring LOGIN CONNECTION LIMIT 3;
GRANT pg_read_all_data TO bi_reader;
GRANT pg_monitor       TO monitoring;

SET ROLE bi_reader;
SELECT current_user, session_user,
       (SELECT count(*) FROM orders)   AS orders_visible,
       (SELECT count(*) FROM payments) AS payments_visible,
       has_table_privilege('orders', 'INSERT') AS can_insert;
RESET ROLE;

SELECT r.rolname AS predefined_role, m.rolname AS member
FROM pg_auth_members am
JOIN pg_roles r ON r.oid = am.roleid
JOIN pg_roles m ON m.oid = am.member
WHERE r.rolname IN ('pg_read_all_data', 'pg_monitor')
ORDER BY 1;`,
      explain: `<p><code>pg_read_all_data</code> grants SELECT on every table, view and sequence (and USAGE on schemas) without listing them - ideal for BI/backup-verification accounts, while <code>can_insert</code> stays false. <code>pg_monitor</code> gives monitoring agents read access to <code>pg_stat_*</code> views and settings. <code>SET ROLE</code> changes <code>current_user</code> (privileges in use) while <code>session_user</code> remains the login identity. Note: RLS still applies to <code>pg_read_all_data</code> members unless they also have BYPASSRLS.</p>`,
      output: ` current_user | session_user | orders_visible | payments_visible | can_insert
--------------+--------------+----------------+------------------+------------
 bi_reader    | postgres     |           5000 |             4585 | f
(1 row)

 predefined_role  | member
------------------+------------
 pg_monitor       | monitoring
 pg_read_all_data | bi_reader
(2 rows)`,
      run: true }
  ],
  compare: {
    bad: { sql: `-- monitoring agent and BI tool given superuser "to avoid permission errors"
CREATE ROLE datadog LOGIN SUPERUSER;
CREATE ROLE tableau LOGIN SUPERUSER;
SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname IN ('datadog','tableau');`, why: 'Two internet-connected tools now hold full control of the cluster: they bypass all privileges and RLS, can read server files and run OS commands.', run: true },
    good: { sql: `CREATE ROLE datadog LOGIN CONNECTION LIMIT 3;
CREATE ROLE tableau LOGIN;
GRANT pg_monitor TO datadog;
GRANT pg_read_all_data TO tableau;
SELECT rolname, rolsuper, rolbypassrls,
       pg_has_role(rolname, 'pg_monitor', 'USAGE') AS monitor,
       pg_has_role(rolname, 'pg_read_all_data', 'USAGE') AS read_all
FROM pg_roles WHERE rolname IN ('datadog','tableau');`, why: 'Predefined roles give exactly the access needed (monitoring views; read-only data) with no superuser powers.', run: true }
  },
  mistakes: [
    'Granting privileges to individual login roles instead of group roles.',
    'Giving application or tool roles <code>SUPERUSER</code>, <code>CREATEROLE</code> or <code>BYPASSRLS</code>.',
    'Expecting <code>DROP ROLE</code> to work while the role still owns objects - use <code>REASSIGN OWNED</code> / <code>DROP OWNED</code> in every database first.',
    'Forgetting roles are cluster-wide: a role created for one database can connect to others unless CONNECT is restricted.',
    'Confusing <code>session_user</code> and <code>current_user</code> in audit triggers (use session_user for "who logged in").'
  ],
  best: [
    'Model access as NOLOGIN group roles; personal and service LOGIN roles are members.',
    'Use predefined roles (pg_monitor, pg_read_all_data, pg_maintain, pg_signal_backend) instead of superuser.',
    'Set <code>CONNECTION LIMIT</code> on service roles and <code>VALID UNTIL</code> on temporary accounts.',
    'For powerful groups, grant membership <code>WITH INHERIT FALSE</code> so people must SET ROLE deliberately.',
    'Review <code>pg_roles</code> and <code>pg_auth_members</code> periodically; remove leavers promptly.'
  ],
  performance: `<p>Role checks are cheap, but very deep or wide membership graphs (thousands of roles with nested groups) add overhead to privilege checks and to <code>pg_has_role</code>. Connection limits per role protect the server from one runaway service exhausting <code>max_connections</code>.</p>`,
  security: `<p>Every attribute is a potential escalation path: <code>CREATEROLE</code> (pre-PG16 could grant itself almost anything), <code>pg_execute_server_program</code> (OS commands), <code>pg_write_server_files</code>. Keep superuser for break-glass use, prefer peer/cert authentication for it, and log role changes (pgaudit ROLE class).</p>`,
  scenario: { title: 'Offboarding an engineer who owned production tables', steps: [
    '1. REVOKE group memberships and set NOLOGIN immediately: ALTER ROLE eng_x NOLOGIN.',
    '2. Find owned objects: query pg_class/pg_proc where owner = eng_x in every database.',
    '3. REASSIGN OWNED BY eng_x TO app_owner; DROP OWNED BY eng_x; (per database).',
    '4. DROP ROLE eng_x.',
    '5. Prevent recurrence: objects are created by the NOLOGIN owner role via migrations only.'
  ] },
  widgets: ['lab:security'],
  interview: [
    { q: 'What is the difference between a user and a role in PostgreSQL?', a: 'There is none at the catalog level: everything is a role. A "user" is a role with the LOGIN attribute; CREATE USER is CREATE ROLE with LOGIN by default. Group roles are typically NOLOGIN roles that hold privileges and have members.' },
    { q: 'Explain INHERIT, SET and ADMIN membership options in PostgreSQL 16.', a: 'INHERIT means the member automatically uses the group\'s privileges; SET allows the member to SET ROLE to the group; ADMIN allows granting and revoking the membership to others. They can be combined per membership, e.g. WITH INHERIT FALSE, SET TRUE for sudo-like roles.' },
    { q: 'How would you give a monitoring tool access without superuser?', a: 'Create a LOGIN role with a connection limit and grant it pg_monitor, which includes pg_read_all_settings, pg_read_all_stats and pg_stat_scan_tables. If it needs to cancel queries, add pg_signal_backend.' },
    { q: 'Why does DROP ROLE fail with "role cannot be dropped because some objects depend on it"?', a: 'The role owns objects or has privileges in one or more databases. Run REASSIGN OWNED BY role TO new_owner and DROP OWNED BY role in each database, then DROP ROLE.' }
  ],
  exercises: [
    { task: 'Create a NOLOGIN group "support_team" and a login role "ravi" that is a member, then verify the membership with pg_has_role.',
      solution: `CREATE ROLE support_team NOLOGIN;
CREATE ROLE ravi LOGIN PASSWORD 'Ravi#2025';
GRANT support_team TO ravi;
SELECT pg_has_role('ravi', 'support_team', 'MEMBER') AS is_member,
       pg_has_role('ravi', 'support_team', 'USAGE')  AS inherits;`, run: true },
    { task: 'List all predefined roles available in this PostgreSQL version.',
      solution: `SELECT rolname FROM pg_roles WHERE rolname LIKE 'pg\\_%' ORDER BY rolname;`, run: true }
  ],
  challenge: { task: 'Create role "ops" that can cancel/terminate other sessions and run VACUUM/ANALYZE on all tables without being superuser, and prove it holds both capabilities.',
    hint: 'pg_signal_backend and pg_maintain (PostgreSQL 17+).',
    solution: `CREATE ROLE ops LOGIN;
GRANT pg_signal_backend, pg_maintain TO ops;
SELECT pg_has_role('ops', 'pg_signal_backend', 'USAGE') AS can_signal,
       pg_has_role('ops', 'pg_maintain', 'USAGE')       AS can_maintain,
       (SELECT rolsuper FROM pg_roles WHERE rolname = 'ops') AS is_superuser;
SET ROLE ops;
ANALYZE orders;
RESET ROLE;`, run: true },
  related: ['roles-permissions-grant-revoke', 'roles-permissions-least-privilege', 'security-hardening-checklist', 'security'],
  quiz: [
    { type: 'tf', q: 'CREATE USER and CREATE ROLE are identical except that CREATE USER defaults to LOGIN.', answer: true, explain: 'Both create a role; CREATE USER adds LOGIN by default.' },
    { type: 'mcq', q: 'Which predefined role suits a monitoring agent?', options: ['pg_write_all_data', 'pg_monitor', 'pg_execute_server_program', 'pg_database_owner'], answer: 1, explain: 'pg_monitor bundles read access to stats and settings.' },
    { type: 'predict', q: 'After this, can bob SELECT from orders without SET ROLE?', code: `GRANT SELECT ON orders TO analysts;
GRANT analysts TO bob WITH INHERIT FALSE;`, options: ['Yes', 'No', 'Only if bob is superuser', 'Only on PG15'], answer: 1, explain: 'Without inheritance bob must SET ROLE analysts first (unless superuser).' },
    { type: 'mcq', q: 'Which attribute lets a role ignore row-level security?', options: ['INHERIT', 'BYPASSRLS', 'CREATEROLE', 'REPLICATION'], answer: 1, explain: 'BYPASSRLS (and SUPERUSER) bypass RLS policies.' }
  ]
},
/* ------------------------------------------------------------------ */
{
  id: 'roles-permissions-grant-revoke',
  module: 'roles-permissions',
  title: 'GRANT, REVOKE and ALTER DEFAULT PRIVILEGES',
  level: 4,
  minutes: 26,
  summary: 'Grant and revoke privileges on databases, schemas, tables, columns, sequences and functions, read ACL strings, and make future objects inherit the right grants with ALTER DEFAULT PRIVILEGES.',
  objectives: [
    'Know which privileges exist for each object type (CONNECT, USAGE, CREATE, SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, EXECUTE, MAINTAIN)',
    'Grant table and column-level privileges and verify them',
    'Handle sequences and identity columns correctly',
    'Revoke EXECUTE on functions from PUBLIC',
    'Use ALTER DEFAULT PRIVILEGES for objects created in the future',
    'Read aclitem strings like app_rw=arwd/app_owner'
  ],
  concept: `<p>Access in PostgreSQL is layered. To read <code>app.orders</code> a role needs <strong>CONNECT</strong> on the database, <strong>USAGE</strong> on schema <code>app</code>, and <strong>SELECT</strong> on the table (or on the specific columns). Missing any layer means "permission denied".</p>
<p><strong>Analogy - a hospital.</strong> CONNECT is entering the hospital building, USAGE on a schema is entering a ward, and table privileges decide whether you may read a patient chart (SELECT), write in it (INSERT/UPDATE) or shred it (DELETE/TRUNCATE). Column privileges let a receptionist see the patient's name but not the diagnosis.</p>
<h4>Privileges by object</h4>
<table>
<tr><th>Object</th><th>Privileges</th></tr>
<tr><td>DATABASE</td><td>CONNECT, CREATE (schemas), TEMPORARY</td></tr>
<tr><td>SCHEMA</td><td>USAGE (look up objects), CREATE (create objects)</td></tr>
<tr><td>TABLE / VIEW</td><td>SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN (PG17)</td></tr>
<tr><td>COLUMN</td><td>SELECT, INSERT, UPDATE, REFERENCES</td></tr>
<tr><td>SEQUENCE</td><td>USAGE (nextval/currval), SELECT (currval), UPDATE (setval)</td></tr>
<tr><td>FUNCTION / PROCEDURE</td><td>EXECUTE (granted to PUBLIC by default!)</td></tr>
<tr><td>TYPE, DOMAIN, LANGUAGE, FDW, TABLESPACE...</td><td>USAGE / CREATE</td></tr>
</table>
<h4>ACL strings</h4>
<p><code>app_rw=arwd/app_owner</code> means grantee <code>app_rw</code> has <strong>a</strong>ppend (INSERT), <strong>r</strong>ead (SELECT), <strong>w</strong>rite (UPDATE), <strong>d</strong>elete, granted by <code>app_owner</code>. Other letters: <code>D</code> TRUNCATE, <code>x</code> REFERENCES, <code>t</code> TRIGGER, <code>m</code> MAINTAIN, <code>X</code> EXECUTE, <code>U</code> USAGE, <code>C</code> CREATE, <code>c</code> CONNECT, <code>T</code> TEMPORARY, <code>*</code> after a letter = WITH GRANT OPTION. An empty grantee (<code>=U/...</code>) means PUBLIC.</p>
<h4>Default privileges</h4>
<p><code>GRANT SELECT ON ALL TABLES IN SCHEMA app TO app_ro</code> only affects tables that exist <em>now</em>. For future tables use <code>ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA app GRANT SELECT ON TABLES TO app_ro</code>. Default privileges apply to objects created <em>by the specified role</em> (<code>FOR ROLE</code>, default: yourself) - a frequent source of confusion when migrations run as a different role.</p>
<p>Identity columns (<code>GENERATED ... AS IDENTITY</code>) do not require sequence privileges for inserts; <code>serial</code> columns do (grant USAGE on the sequence).</p>`,
  why: `<p>Without precise grants teams either over-grant (every role owns everything, every role can DROP tables) or fight constant "permission denied" errors. Column privileges protect sensitive fields; default privileges keep permissions correct as migrations add tables; revoking EXECUTE from PUBLIC prevents unintended use of powerful functions.</p>`,
  useCase: `<p>An HR system lets the reporting role read <code>employees</code> but not <code>salary</code>: <code>GRANT SELECT (id, first_name, last_name, department_id, job_title) ON employees TO reporting</code>. A payroll role has full SELECT. Migrations run as <code>hr_owner</code>; <code>ALTER DEFAULT PRIVILEGES FOR ROLE hr_owner</code> grants DML on new tables to <code>hr_app</code> and SELECT to <code>reporting</code>, so new tables never ship with missing or excessive grants.</p>`,
  internals: `<p>Privileges are stored as <code>aclitem[]</code> arrays: <code>pg_database.datacl</code>, <code>pg_namespace.nspacl</code>, <code>pg_class.relacl</code>, <code>pg_attribute.attacl</code> (columns), <code>pg_proc.proacl</code>. A NULL ACL means "default privileges for the object type" (owner has all; PUBLIC gets EXECUTE on functions, USAGE on languages/types, CONNECT/TEMP on databases). <code>aclexplode()</code> expands an ACL into rows; <code>has_*_privilege()</code> functions evaluate effective privileges including inheritance. Default privileges are stored in <code>pg_default_acl</code> and merged into the new object's ACL at creation time - they are not retroactive.</p>`,
  whenNot: `<ul><li>Do not use <code>GRANT ALL PRIVILEGES</code> to application roles - it includes TRUNCATE, REFERENCES, TRIGGER.</li>
<li>Do not grant on individual tables one by one in every migration if default privileges can do it.</li>
<li>Column privileges are not row filtering - use Row Level Security or views for rows.</li></ul>`,
  syntax: `GRANT CONNECT ON DATABASE app_db TO app_rw;
GRANT USAGE ON SCHEMA app TO app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO app_rw;
GRANT SELECT (id, name) ON app.customers TO support;             -- column-level
GRANT USAGE ON ALL SEQUENCES IN SCHEMA app TO app_rw;            -- for serial columns
REVOKE EXECUTE ON FUNCTION app.reset_all() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.reset_all() TO app_admin;
REVOKE INSERT ON app.orders FROM app_ro;
GRANT SELECT ON app.orders TO lead WITH GRANT OPTION;

ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA app
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rw;
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA app
  GRANT USAGE ON SEQUENCES TO app_rw;
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;`,
  examples: [
    { label: 'Basic', title: 'Table privileges and has_table_privilege',
      sql: `CREATE ROLE sales_app NOLOGIN;
GRANT SELECT, INSERT, UPDATE ON orders, order_items TO sales_app;
GRANT SELECT ON customers, products TO sales_app;

SELECT t.tbl,
       has_table_privilege('sales_app', t.tbl, 'SELECT') AS sel,
       has_table_privilege('sales_app', t.tbl, 'INSERT') AS ins,
       has_table_privilege('sales_app', t.tbl, 'UPDATE') AS upd,
       has_table_privilege('sales_app', t.tbl, 'DELETE') AS del
FROM (VALUES ('orders'), ('order_items'), ('customers'), ('payments')) AS t(tbl)
ORDER BY t.tbl;`,
      explain: `<p>The sales application may create and modify orders, read customers and products, and has no access to payments or DELETE anywhere. <code>has_table_privilege(role, table, privilege)</code> evaluates the effective privilege (including group inheritance) - the right way to test grants in CI. Grants are additive; there are no "deny" entries in PostgreSQL.</p>`,
      output: ` tbl         | sel | ins | upd | del
-------------+-----+-----+-----+-----
 customers   | t   | f   | f   | f
 order_items | t   | t   | t   | f
 orders      | t   | t   | t   | f
 payments    | f   | f   | f   | f
(4 rows)`,
      run: true },
    { label: 'Intermediate', title: 'Column-level privileges: hide password_hash and email',
      sql: `CREATE ROLE helpdesk NOLOGIN;
GRANT SELECT (id, username, role, tenant_id, is_active, last_login) ON users TO helpdesk;
GRANT UPDATE (is_active) ON users TO helpdesk;          -- may lock/unlock accounts only

SET ROLE helpdesk;
SELECT id, username, role, is_active FROM users ORDER BY id LIMIT 3;   -- allowed columns
UPDATE users SET is_active = false WHERE id = 3;                        -- allowed column
RESET ROLE;

SELECT a.attname AS column_name,
       has_column_privilege('helpdesk', 'users', a.attname, 'SELECT') AS can_select,
       has_column_privilege('helpdesk', 'users', a.attname, 'UPDATE') AS can_update
FROM pg_attribute a
WHERE a.attrelid = 'users'::regclass AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY a.attnum;`,
      explain: `<p>Column privileges let helpdesk see who an account is and lock it, but never read <code>password_hash</code> or <code>email</code>. A <code>SELECT *</code> by helpdesk would fail with "permission denied for table users" because it touches forbidden columns - queries must name allowed columns. The <code>UPDATE ... WHERE id = 3</code> also needs SELECT on <code>id</code> (used in WHERE), which we granted.</p>`,
      output: ` id | username | role    | is_active
----+----------+---------+-----------
  1 | user1    | manager | t
  2 | user2    | analyst | t
  3 | user3    | viewer  | t
(3 rows)

UPDATE 1

 column_name   | can_select | can_update
---------------+------------+------------
 id            | t          | f
 username      | t          | f
 email         | f          | f
 password_hash | f          | f
 role          | t          | f
 tenant_id     | t          | f
 is_active     | t          | t
 last_login    | t          | f
 created_at    | f          | f
(9 rows)`,
      run: true },
    { label: 'Advanced', title: 'ALTER DEFAULT PRIVILEGES for future tables, sequences and functions',
      sql: `CREATE ROLE app_owner NOLOGIN;
CREATE ROLE app_rw    NOLOGIN;
CREATE ROLE app_ro    NOLOGIN;
CREATE SCHEMA shop AUTHORIZATION app_owner;
GRANT USAGE ON SCHEMA shop TO app_rw, app_ro;

ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA shop
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rw;
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA shop
  GRANT SELECT ON TABLES TO app_ro;
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA shop
  GRANT USAGE ON SEQUENCES TO app_rw;
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- a later migration, running as the owner role
SET ROLE app_owner;
CREATE TABLE shop.carts (id serial PRIMARY KEY, customer_id int, created_at timestamptz DEFAULT now());
CREATE FUNCTION shop.purge_carts() RETURNS void LANGUAGE sql AS 'DELETE FROM shop.carts';
RESET ROLE;

SELECT c.relname, c.relkind, a.grantee::regrole AS grantee, string_agg(a.privilege_type, ', ' ORDER BY a.privilege_type) AS privileges
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'shop'
CROSS JOIN LATERAL aclexplode(c.relacl) a
WHERE a.grantee <> c.relowner
GROUP BY 1, 2, 3 ORDER BY 1, 3;

SELECT has_function_privilege('app_rw', 'shop.purge_carts()', 'EXECUTE') AS app_rw_can_purge;`,
      explain: `<p>Default privileges are attached to the <em>creating role</em> (<code>FOR ROLE app_owner</code>) and schema. When the migration (running as <code>app_owner</code>) creates <code>shop.carts</code>, it is born with DML for <code>app_rw</code> and SELECT for <code>app_ro</code>; its <code>serial</code> sequence gets USAGE for <code>app_rw</code> so inserts work; the new function is <em>not</em> executable by PUBLIC. If migrations ran as a different role, none of this would apply - the most common default-privileges bug.</p>`,
      output: ` relname      | relkind | grantee | privileges
--------------+---------+---------+--------------------------------
 carts        | r       | app_ro  | SELECT
 carts        | r       | app_rw  | DELETE, INSERT, SELECT, UPDATE
 carts_id_seq | S       | app_rw  | USAGE
(3 rows)

 app_rw_can_purge
------------------
 f
(1 row)`,
      run: true }
  ],
  compare: {
    bad: { sql: `CREATE ROLE app_ro NOLOGIN;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_ro;    -- only tables that exist now
CREATE TABLE shipments (id int PRIMARY KEY, order_id bigint);   -- added by next migration
SELECT has_table_privilege('app_ro', 'shipments', 'SELECT') AS can_read_new_table;`, why: 'GRANT ... ON ALL TABLES is a one-time snapshot; every table added later is invisible to app_ro until someone remembers to grant it.', run: true },
    good: { sql: `CREATE ROLE app_ro NOLOGIN;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_ro;               -- existing tables
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO app_ro;   -- future tables (created by this role)
CREATE TABLE shipments (id int PRIMARY KEY, order_id bigint);
SELECT has_table_privilege('app_ro', 'shipments', 'SELECT') AS can_read_new_table;`, why: 'Combine a one-time GRANT for existing tables with ALTER DEFAULT PRIVILEGES for tables created later by the same role.', run: true }
  },
  mistakes: [
    'Granting table privileges but forgetting USAGE on the schema (or CONNECT on the database).',
    'Setting default privileges as yourself while migrations create objects as another role - use <code>FOR ROLE migration_owner</code>.',
    'Forgetting USAGE on sequences for <code>serial</code> columns ("permission denied for sequence orders_id_seq").',
    'Leaving EXECUTE granted to PUBLIC on SECURITY DEFINER or administrative functions.',
    'Expecting REVOKE to remove privileges a role still gets via group membership or PUBLIC.',
    'Using <code>GRANT ALL</code> for application roles.'
  ],
  best: [
    'Grant to group roles; grant schema USAGE explicitly; restrict database CONNECT.',
    'Run all DDL as a single owner role and configure <code>ALTER DEFAULT PRIVILEGES FOR ROLE owner</code>.',
    'Prefer identity columns (no sequence grants needed) over serial.',
    'Revoke EXECUTE on functions from PUBLIC by default; grant to specific roles.',
    'Use column privileges or views for sensitive columns; test grants with <code>has_*_privilege</code> in CI.'
  ],
  performance: `<p>Privilege checks happen once per object per query at executor start - negligible. Very large ACL arrays (hundreds of grantees on one table) slightly slow checks and catalog reads; group roles keep ACLs short.</p>`,
  security: `<p>Remember PUBLIC: functions are executable by everyone unless revoked, and databases allow CONNECT/TEMP by PUBLIC by default. <code>WITH GRANT OPTION</code> lets a role re-grant privileges - avoid for application roles. Revoking a privilege granted WITH GRANT OPTION needs <code>CASCADE</code> to remove downstream grants.</p>`,
  scenario: { title: '"permission denied for table invoices" after a new migration', steps: [
    '1. Check layers: has_database_privilege(..., CONNECT), has_schema_privilege(..., USAGE), has_table_privilege(..., SELECT).',
    '2. Inspect the ACL: SELECT relacl FROM pg_class WHERE relname = \'invoices\' - only the owner present?',
    '3. Check pg_default_acl: are default privileges defined FOR ROLE of the role that ran the migration?',
    '4. Fix now: GRANT the missing privilege; fix forever: ALTER DEFAULT PRIVILEGES FOR ROLE migration_role IN SCHEMA ...',
    '5. Add a CI test that asserts has_table_privilege for app roles on every table.'
  ] },
  widgets: ['lab:security'],
  interview: [
    { q: 'What does ALTER DEFAULT PRIVILEGES do and what is the classic pitfall?', a: 'It defines privileges automatically added to objects created in the future by a given role (optionally in a given schema). The pitfall is that it applies only to objects created by the role named in FOR ROLE (default: the current role), so if migrations run as a different role the defaults never apply.' },
    { q: 'What privileges are needed to SELECT from app.orders?', a: 'CONNECT on the database, USAGE on schema app, and SELECT on the table or on the referenced columns. With RLS enabled, a policy must also allow the rows.' },
    { q: 'Decode the ACL entry reporting=r*/app_owner.', a: 'The role reporting has SELECT (r) with grant option (*), granted by app_owner. It can therefore re-grant SELECT on that object to others.' },
    { q: 'Why revoke EXECUTE on functions from PUBLIC?', a: 'New functions are executable by PUBLIC by default. For SECURITY DEFINER or administrative functions that means any role could run them with the owner\'s privileges. Revoking from PUBLIC and granting to specific roles applies least privilege.' }
  ],
  exercises: [
    { task: 'Give role "auditor" read access to audit_logs only, and verify it cannot read users.',
      solution: `CREATE ROLE auditor NOLOGIN;
GRANT SELECT ON audit_logs TO auditor;
SELECT has_table_privilege('auditor', 'audit_logs', 'SELECT') AS audit_logs,
       has_table_privilege('auditor', 'users', 'SELECT') AS users;`, run: true },
    { task: 'Show every explicit (non-owner) table privilege in the public schema using aclexplode.',
      solution: `CREATE ROLE demo_reader NOLOGIN;
GRANT SELECT ON departments TO demo_reader;
SELECT c.relname, a.grantee::regrole AS grantee, a.privilege_type, a.is_grantable
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
CROSS JOIN LATERAL aclexplode(c.relacl) a
WHERE a.grantee <> c.relowner
ORDER BY 1, 2, 3;`, run: true }
  ],
  challenge: { task: 'Create role "pricing" that may read products and update ONLY the price column, then prove an update of price works and show it lacks UPDATE on stock.',
    hint: 'GRANT SELECT ON products; GRANT UPDATE (price) ON products; test with SET ROLE.',
    solution: `CREATE ROLE pricing NOLOGIN;
GRANT SELECT ON products TO pricing;
GRANT UPDATE (price) ON products TO pricing;
SET ROLE pricing;
UPDATE products SET price = price * 1.05 WHERE category = 'audio';
RESET ROLE;
SELECT has_column_privilege('pricing', 'products', 'price', 'UPDATE') AS price_upd,
       has_column_privilege('pricing', 'products', 'stock', 'UPDATE') AS stock_upd;`, run: true },
  related: ['roles-permissions-roles-users', 'roles-permissions-least-privilege', 'row-level-security', 'views'],
  quiz: [
    { type: 'mcq', q: 'In app_rw=arwd/app_owner, what does "a" mean?', options: ['ALL', 'INSERT (append)', 'ALTER', 'ANALYZE'], answer: 1, explain: 'a = INSERT, r = SELECT, w = UPDATE, d = DELETE.' },
    { type: 'tf', q: 'GRANT SELECT ON ALL TABLES IN SCHEMA s also covers tables created later.', answer: false, explain: 'Only existing tables; use ALTER DEFAULT PRIVILEGES for future ones.' },
    { type: 'bug', q: 'app_rw gets "permission denied for schema shop". Why?', code: `GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA shop TO app_rw;`, options: ['Needs GRANT USAGE ON SCHEMA shop', 'Needs SUPERUSER', 'Needs CREATE on database', 'Needs WITH GRANT OPTION'], answer: 0, explain: 'Schema USAGE is required to look up objects in the schema.' },
    { type: 'mcq', q: 'Which objects grant EXECUTE to PUBLIC by default?', options: ['Tables', 'Functions/procedures', 'Schemas', 'Sequences'], answer: 1, explain: 'Functions are executable by PUBLIC unless revoked.' },
    { type: 'write', q: 'Write SQL so that role app_ro can read every table created in the future by role app_owner in schema shop.', solution: `ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA shop GRANT SELECT ON TABLES TO app_ro;`, explain: 'Default privileges must name the creating role (FOR ROLE) and the schema.' }
  ]
},
/* ------------------------------------------------------------------ */
{
  id: 'roles-permissions-least-privilege',
  module: 'roles-permissions',
  title: 'Least-Privilege Application Design: Owner, App and Read-Only Roles',
  level: 4,
  minutes: 26,
  summary: 'The production pattern: a NOLOGIN owner role for DDL, a read-write app role, a read-only role, login users as members, dedicated schemas - plus queries to audit privileges like psql \\dp.',
  objectives: [
    'Implement the owner / app (read-write) / read-only role pattern end to end',
    'Separate migration credentials from runtime credentials',
    'Use a dedicated schema and search_path instead of public',
    'Audit privileges with has_table_privilege matrices and a \\dp-equivalent catalog query',
    'Detect privilege drift (unexpected owners, grants to PUBLIC)',
    'Explain why the app role must not own its tables'
  ],
  concept: `<p>The <strong>three-role pattern</strong> is the backbone of least privilege in PostgreSQL:</p>
<table>
<tr><th>Role</th><th>Type</th><th>Can do</th><th>Used by</th></tr>
<tr><td><code>app_owner</code></td><td>NOLOGIN</td><td>Owns schema and all objects: DDL (CREATE/ALTER/DROP), grants</td><td>Migrations (via a login role that is a member with SET, e.g. <code>migrator</code>)</td></tr>
<tr><td><code>app_rw</code></td><td>NOLOGIN group</td><td>SELECT/INSERT/UPDATE/DELETE on tables, USAGE on sequences, EXECUTE on chosen functions</td><td>Application service login roles (<code>app_api</code>, <code>app_worker</code>)</td></tr>
<tr><td><code>app_ro</code></td><td>NOLOGIN group</td><td>SELECT only</td><td>Reporting, BI, read replicas, support tools</td></tr>
</table>
<p><strong>Analogy - a restaurant.</strong> The owner (app_owner) can rebuild the kitchen; cooks (app_rw) use the kitchen every day but cannot knock down walls; the food critic (app_ro) may only taste. Nobody gives the cooks the building's deed - if a cook goes rogue, the building survives.</p>
<h4>Why the app must not own tables</h4>
<ul>
<li>Owners can <code>DROP</code>, <code>ALTER</code>, <code>TRUNCATE</code>, and change grants - a SQL injection or a bad deploy can destroy the schema.</li>
<li>Owners bypass RLS unless <code>FORCE ROW LEVEL SECURITY</code> is set.</li>
<li>Separating DDL credentials means runtime credentials leaked from an app server cannot alter the schema.</li>
</ul>
<h4>Schema hygiene</h4>
<ul>
<li>Create a dedicated schema (<code>CREATE SCHEMA app AUTHORIZATION app_owner</code>); grant USAGE to app_rw/app_ro; nobody but the owner gets CREATE.</li>
<li>Set <code>ALTER ROLE app_api SET search_path = app</code> (or qualify names) so objects resolve predictably.</li>
<li>Restrict <code>CONNECT</code> on the database to the groups that need it.</li>
</ul>
<h4>Checking privileges</h4>
<p>psql's <code>\\dp</code> (or <code>\\z</code>) shows table ACLs; it is a meta-command (client-side), so in code use the catalog: <code>pg_class.relacl</code> + <code>aclexplode()</code>, <code>information_schema.role_table_grants</code>, and the <code>has_table_privilege</code>, <code>has_schema_privilege</code>, <code>has_column_privilege</code>, <code>has_function_privilege</code>, <code>has_sequence_privilege</code> functions.</p>`,
  why: `<p>Least privilege limits the blast radius of bugs, leaked credentials and insiders. It also makes audits straightforward: "which roles can modify payments?" becomes a single query. Teams that skip it usually discover the gap after an incident - an ORM migration dropping a column in production, or an injection that truncated a table.</p>`,
  useCase: `<p>A logistics platform with 30 microservices: each service has its own LOGIN role (<code>svc_tracking</code>, <code>svc_billing</code>) that is a member of either <code>app_rw</code> or a narrower group (<code>billing_rw</code> with access only to the billing schema). The CI pipeline uses <code>migrator</code> (member of <code>app_owner</code> with SET) to run Flyway <span class="tag tool">third-party tool</span>. Metabase uses <code>bi_ro</code> on a read replica. A weekly job diffs the privilege matrix against a committed baseline and alerts on drift.</p>`,
  internals: `<p>Ownership is recorded in <code>relowner</code>/<code>nspowner</code>/<code>proowner</code>; owner privileges are implicit (not in the ACL unless modified). Membership with <code>SET</code> lets <code>migrator</code> run <code>SET ROLE app_owner</code> so new objects are owned by <code>app_owner</code> and receive its default privileges. <code>ALTER ROLE ... SET search_path</code> stores per-role settings in <code>pg_db_role_setting</code>, applied at login. All privilege functions accept role names or OIDs and evaluate inheritance, so they reflect what a session would actually be allowed to do.</p>`,
  whenNot: `<ul><li>For a throwaway prototype on a laptop the full pattern is overkill - but adopt it before the first shared or production environment.</li>
<li>Do not create a separate database role per end user of a consumer app; combine the app role with RLS and an application user id setting.</li></ul>`,
  syntax: `-- one-time setup (as an admin)
CREATE ROLE app_owner NOLOGIN;
CREATE ROLE app_rw    NOLOGIN;
CREATE ROLE app_ro    NOLOGIN;
CREATE ROLE migrator  LOGIN PASSWORD '...' IN ROLE app_owner;     -- member of app_owner
CREATE ROLE app_api   LOGIN PASSWORD '...' IN ROLE app_rw;
CREATE ROLE bi_user   LOGIN PASSWORD '...' IN ROLE app_ro;
CREATE SCHEMA app AUTHORIZATION app_owner;
GRANT USAGE ON SCHEMA app TO app_rw, app_ro;
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA app GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rw;
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA app GRANT SELECT ON TABLES TO app_ro;
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA app GRANT USAGE ON SEQUENCES TO app_rw;
ALTER ROLE app_api SET search_path = app;

-- migrations
SET ROLE app_owner;  CREATE TABLE app.orders (...);  RESET ROLE;`,
  examples: [
    { label: 'Basic', title: 'Build the owner / rw / ro pattern',
      sql: `CREATE ROLE app_owner NOLOGIN;
CREATE ROLE app_rw    NOLOGIN;
CREATE ROLE app_ro    NOLOGIN;
CREATE ROLE migrator  LOGIN IN ROLE app_owner;
CREATE ROLE app_api   LOGIN IN ROLE app_rw;
CREATE ROLE bi_user   LOGIN IN ROLE app_ro;

CREATE SCHEMA app AUTHORIZATION app_owner;
GRANT USAGE ON SCHEMA app TO app_rw, app_ro;
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA app
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rw;
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA app
  GRANT SELECT ON TABLES TO app_ro;

SET ROLE migrator;          -- CI pipeline logs in as migrator
SET ROLE app_owner;         -- ...and creates objects as the owner
CREATE TABLE app.invoices (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                           customer_id int NOT NULL, amount numeric(10,2) NOT NULL);
RESET ROLE;

SELECT r.role,
       has_table_privilege(r.role, 'app.invoices', 'SELECT') AS sel,
       has_table_privilege(r.role, 'app.invoices', 'INSERT') AS ins,
       has_table_privilege(r.role, 'app.invoices', 'DELETE') AS del,
       has_schema_privilege(r.role, 'app', 'CREATE')         AS ddl
FROM (VALUES ('app_api'), ('bi_user'), ('migrator')) AS r(role);`,
      explain: `<p><code>IN ROLE</code> at creation makes each login role a member of its group. The CI identity <code>migrator</code> switches to <code>app_owner</code> before DDL so the table is owned by <code>app_owner</code> and default privileges fire. Result: <code>app_api</code> has DML but no DDL; <code>bi_user</code> can only read; <code>migrator</code> (through <code>app_owner</code>) can do everything in the schema. Identity columns need no sequence grants.</p>`,
      output: ` role     | sel | ins | del | ddl
----------+-----+-----+-----+-----
 app_api  | t   | t   | t   | f
 bi_user  | t   | f   | f   | f
 migrator | t   | t   | t   | t
(3 rows)`,
      run: true },
    { label: 'Intermediate', title: 'A \\dp equivalent: ACLs from the catalog',
      sql: `CREATE ROLE app_ro NOLOGIN;
CREATE ROLE helpdesk NOLOGIN;
GRANT SELECT ON orders, customers TO app_ro;
GRANT SELECT (id, username, role) ON users TO helpdesk;

SELECT n.nspname AS schema,
       c.relname AS name,
       CASE c.relkind WHEN 'r' THEN 'table' WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized view'
                      WHEN 'S' THEN 'sequence' WHEN 'p' THEN 'partitioned table' END AS type,
       array_to_string(c.relacl, ' ') AS access_privileges,
       (SELECT string_agg(a.attname || ': ' || array_to_string(a.attacl, ' '), '; ')
          FROM pg_attribute a
         WHERE a.attrelid = c.oid AND a.attacl IS NOT NULL) AS column_privileges
FROM   pg_class c
JOIN   pg_namespace n ON n.oid = c.relnamespace
WHERE  n.nspname = 'public'
  AND  c.relkind IN ('r', 'v', 'm', 'S', 'p')
  AND  (c.relacl IS NOT NULL OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attacl IS NOT NULL))
ORDER  BY 1, 2;`,
      explain: `<p>This reproduces psql's <code>\\dp</code> output in plain SQL, so it can run from any client, CI job or monitoring tool. <code>relacl</code> holds table-level ACL items; <code>pg_attribute.attacl</code> holds column-level ones. Tables with a NULL ACL (never granted) are omitted - they use default privileges (owner only).</p>`,
      output: ` schema | name      | type  | access_privileges                              | column_privileges
--------+-----------+-------+------------------------------------------------+---------------------------------------------------------------------
 public | customers | table | postgres=arwdDxtm/postgres app_ro=r/postgres   |
 public | orders    | table | postgres=arwdDxtm/postgres app_ro=r/postgres   |
 public | users     | table |                                                | id: helpdesk=r/postgres; username: helpdesk=r/postgres; role: helpdesk=r/postgres
(3 rows)`,
      run: true },
    { label: 'Advanced', title: 'Privilege matrix and drift detection',
      sql: `CREATE ROLE app_rw NOLOGIN;
CREATE ROLE app_ro NOLOGIN;
GRANT SELECT, INSERT, UPDATE, DELETE ON orders, order_items, payments TO app_rw;
GRANT SELECT ON orders, order_items, payments, customers TO app_ro;
GRANT TRUNCATE ON payments TO app_rw;        -- drift: someone added a dangerous grant
GRANT SELECT ON audit_logs TO PUBLIC;        -- drift: readable by everyone

-- 1) matrix: role x table x privileges
SELECT t.tbl,
       string_agg(r.role || '=' ||
         concat_ws('', CASE WHEN has_table_privilege(r.role, t.tbl, 'SELECT')   THEN 'r' END,
                       CASE WHEN has_table_privilege(r.role, t.tbl, 'INSERT')   THEN 'a' END,
                       CASE WHEN has_table_privilege(r.role, t.tbl, 'UPDATE')   THEN 'w' END,
                       CASE WHEN has_table_privilege(r.role, t.tbl, 'DELETE')   THEN 'd' END,
                       CASE WHEN has_table_privilege(r.role, t.tbl, 'TRUNCATE') THEN 'D' END),
         '  ' ORDER BY r.role) AS effective
FROM (VALUES ('orders'), ('payments'), ('customers'), ('audit_logs')) AS t(tbl)
CROSS JOIN (VALUES ('app_rw'), ('app_ro')) AS r(role)
GROUP BY t.tbl ORDER BY t.tbl;

-- 2) drift rules: TRUNCATE for app roles, anything granted to PUBLIC
SELECT c.relname, CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS grantee, a.privilege_type
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
CROSS JOIN LATERAL aclexplode(c.relacl) a
WHERE a.grantee = 0 OR a.privilege_type IN ('TRUNCATE', 'TRIGGER', 'REFERENCES') AND a.grantee <> c.relowner
ORDER BY 1, 2;`,
      explain: `<p>The matrix shows effective privileges (including inherited ones) in compact ACL letters - perfect for committing as a baseline and diffing in CI. The drift query flags grants to PUBLIC (grantee OID 0 in <code>aclexplode</code>) and dangerous privileges (TRUNCATE/TRIGGER/REFERENCES) held by non-owners. Note that <code>audit_logs</code> now shows <code>r</code> for both roles because PUBLIC grants apply to everyone.</p>`,
      output: ` tbl        | effective
------------+------------------------
 audit_logs | app_ro=r  app_rw=r
 customers  | app_ro=r  app_rw=
 orders     | app_ro=r  app_rw=rawd
 payments   | app_ro=r  app_rw=rawdD
(4 rows)

 relname    | grantee | privilege_type
------------+---------+----------------
 audit_logs | PUBLIC  | SELECT
 payments   | app_rw  | TRUNCATE
(2 rows)`,
      run: true }
  ],
  compare: {
    bad: { sql: `-- the application role owns its tables
CREATE ROLE webapp LOGIN;
CREATE TABLE sessions_bad (id int PRIMARY KEY, data text);
ALTER TABLE sessions_bad OWNER TO webapp;
SET ROLE webapp;
DROP TABLE sessions_bad;            -- one injected statement and the table is gone
RESET ROLE;
SELECT to_regclass('sessions_bad') AS table_still_exists;`, why: 'An owner can DROP, ALTER and TRUNCATE, so any bug or injection in the app can destroy the schema - and owners bypass RLS by default.', run: true },
    good: { sql: `CREATE ROLE app_owner NOLOGIN;
CREATE ROLE webapp LOGIN;
CREATE TABLE sessions_good (id int PRIMARY KEY, data text);
ALTER TABLE sessions_good OWNER TO app_owner;
GRANT SELECT, INSERT, UPDATE, DELETE ON sessions_good TO webapp;
SELECT has_table_privilege('webapp', 'sessions_good', 'DELETE') AS can_delete_rows,
       pg_has_role('webapp', 'app_owner', 'USAGE')               AS is_owner_member,
       to_regclass('sessions_good') IS NOT NULL                   AS table_exists;`, why: 'The app can manipulate rows but cannot drop or alter the table because it is neither the owner nor a member of the owner role.', run: true }
  },
  mistakes: [
    'Running migrations and the application with the same credentials.',
    'Letting ORMs auto-create tables at runtime (forces the app role to own DDL).',
    'Creating objects as <code>migrator</code> instead of <code>SET ROLE app_owner</code> - ownership and default privileges end up on the wrong role.',
    'Leaving objects in <code>public</code> with CREATE open (pre-PG15 databases).',
    'Not auditing privileges after hotfixes - manual GRANTs accumulate (privilege drift).'
  ],
  best: [
    'NOLOGIN owner role owns everything; DDL only via migrations that SET ROLE to it.',
    'One login role per service, member of app_rw (or a narrower group); BI via app_ro, ideally on a replica.',
    'Dedicated schema(s), USAGE granted explicitly, per-role search_path.',
    'Default privileges for tables, sequences and functions (revoke function EXECUTE from PUBLIC).',
    'Commit a privilege baseline and diff it in CI or a scheduled job.'
  ],
  performance: `<p>No runtime cost worth noting; the pattern also improves operations: connection pool limits per service role, <code>pg_stat_activity.usename</code> immediately shows which service runs a slow query, and per-role settings (<code>ALTER ROLE svc SET statement_timeout = '5s'</code>, <code>work_mem</code>) let you tune workloads separately.</p>`,
  security: `<p>Combine with RLS for row-level isolation, column privileges for sensitive fields, and <code>FORCE ROW LEVEL SECURITY</code> if any login role could end up owning tables. Store each role's credentials separately (secret manager), rotate the migrator credential, and alert on any login as app_owner (it should be NOLOGIN).</p>`,
  scenario: { title: 'Retrofitting least privilege onto a legacy app that connects as the owner', steps: [
    '1. Create app_owner (NOLOGIN), app_rw, app_ro; ALTER ... OWNER TO app_owner for every table, sequence, function and the schema (or REASSIGN OWNED BY legacy TO app_owner).',
    '2. GRANT DML on all tables and USAGE on all sequences to app_rw; set default privileges FOR ROLE app_owner.',
    '3. Create app_api LOGIN IN ROLE app_rw; switch the app connection string; keep the old login for migrations only.',
    '4. Run the test suite: fix any runtime DDL the app performs (move to migrations).',
    '5. Revoke the old role\'s ownership-derived powers and add privilege-drift checks.'
  ] },
  widgets: ['lab:security', 'diagram:client-server'],
  interview: [
    { q: 'Describe the owner / read-write / read-only role pattern.', a: 'A NOLOGIN owner role owns the schema and all objects and is used only for migrations via SET ROLE from a migrator login. A NOLOGIN read-write group gets DML and sequence usage, and application login roles are its members. A NOLOGIN read-only group gets SELECT for reporting. Default privileges for the owner role keep new objects correctly granted.' },
    { q: 'Why should the application role not own its tables?', a: 'Owners can drop, alter and truncate tables and change grants, so any application bug or SQL injection could destroy the schema; owners also bypass RLS unless FORCE ROW LEVEL SECURITY is set. Separating ownership limits the blast radius.' },
    { q: 'How do you see table privileges without psql \\dp?', a: 'Query pg_class.relacl (and pg_attribute.attacl for columns), optionally expanded with aclexplode(), or information_schema.role_table_grants. For effective privileges including inheritance use has_table_privilege and related functions.' }
  ],
  exercises: [
    { task: 'Create a read-only group with access to all current tables in public and a login role in it; verify it cannot insert into orders.',
      solution: `CREATE ROLE readonly NOLOGIN;
GRANT USAGE ON SCHEMA public TO readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO readonly;
CREATE ROLE report_bot LOGIN IN ROLE readonly;
SELECT has_table_privilege('report_bot', 'orders', 'SELECT') AS can_select,
       has_table_privilege('report_bot', 'orders', 'INSERT') AS can_insert;`, run: true },
    { task: 'List the owner of every table in the public schema.',
      solution: `SELECT c.relname, pg_get_userbyid(c.relowner) AS owner
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
ORDER BY 1;`, run: true }
  ],
  challenge: { task: 'Set a per-role statement_timeout of 5s and search_path of app for an app login role, then show the stored per-role settings.',
    hint: 'ALTER ROLE ... SET; settings live in pg_db_role_setting.',
    solution: `CREATE ROLE app_api LOGIN;
ALTER ROLE app_api SET statement_timeout = '5s';
ALTER ROLE app_api SET search_path = app, public;
SELECT r.rolname, s.setconfig
FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole
WHERE r.rolname = 'app_api';`, run: true },
  related: ['roles-permissions-grant-revoke', 'roles-permissions-roles-users', 'row-level-security-policies', 'security-hardening-checklist'],
  quiz: [
    { type: 'design', q: 'Which role should own production tables?', options: ['The application login role', 'A NOLOGIN owner role used by migrations', 'postgres superuser', 'PUBLIC'], answer: 1, explain: 'A dedicated NOLOGIN owner role isolates DDL power from runtime credentials.' },
    { type: 'mcq', q: 'psql \\dp shows...', options: ['Database sizes', 'Table/column access privileges', 'Running queries', 'Dependencies'], answer: 1, explain: '\\dp (alias \\z) lists access privileges; use pg_class.relacl in SQL.' },
    { type: 'tf', q: 'A table owner is subject to RLS policies on its own table by default.', answer: false, explain: 'Owners bypass RLS unless FORCE ROW LEVEL SECURITY is set.' },
    { type: 'scenario', q: 'Migrations run as login "migrator" and new tables are owned by migrator, not app_owner. Fix?', options: ['GRANT ALL to migrator', 'Run SET ROLE app_owner at the start of each migration', 'Make migrator superuser', 'ALTER DEFAULT PRIVILEGES FOR ROLE app_rw'], answer: 1, explain: 'Objects are owned by current_user at creation; SET ROLE app_owner makes the owner role create them.' }
  ]
}
]);

PGM.addLessons([
/* ------------------------------------------------------------------ */
{
  id: 'row-level-security-policies',
  module: 'row-level-security',
  title: 'Row Level Security: Policies, USING vs WITH CHECK, Permissive vs Restrictive',
  level: 4,
  minutes: 28,
  summary: 'Enable RLS, write policies per command, understand USING (which rows are visible) vs WITH CHECK (which rows may be written), combine permissive and restrictive policies, and know who bypasses RLS.',
  objectives: [
    'Enable row level security and create policies for SELECT/INSERT/UPDATE/DELETE/ALL',
    'Explain USING vs WITH CHECK with concrete INSERT and UPDATE examples',
    'Combine permissive (OR) and restrictive (AND) policies correctly',
    'Know who bypasses RLS: superusers, BYPASSRLS roles, table owners (unless FORCE)',
    'Test policies safely with SET ROLE and session settings',
    'Inspect policies with pg_policies'
  ],
  concept: `<p><span class="tag core">core</span> <strong>Row Level Security (RLS)</strong> lets the table itself decide which rows each role may see or modify. Once <code>ALTER TABLE t ENABLE ROW LEVEL SECURITY</code> is run, normal roles see <strong>no rows at all</strong> (default deny) until a policy grants access. GRANTs still decide <em>whether</em> you may SELECT/UPDATE the table; policies decide <em>which rows</em>.</p>
<p><strong>Analogy - a filing cabinet with a smart lock.</strong> GRANT gives you a key to the cabinet. RLS is a lock on each folder that checks your badge: <code>USING</code> decides which folders you can open and read (or update/delete); <code>WITH CHECK</code> decides which folders you are allowed to put back into the cabinet - you cannot file a document into another department's drawer, nor relabel a folder so it moves to someone else.</p>
<h4>USING vs WITH CHECK</h4>
<table>
<tr><th>Command</th><th>USING applies to</th><th>WITH CHECK applies to</th></tr>
<tr><td>SELECT</td><td>Rows returned</td><td>-</td></tr>
<tr><td>INSERT</td><td>-</td><td>New rows (error if violated)</td></tr>
<tr><td>UPDATE</td><td>Rows that can be targeted (silently skipped otherwise)</td><td>The row <em>after</em> the update (error if violated)</td></tr>
<tr><td>DELETE</td><td>Rows that can be deleted (silently skipped)</td><td>-</td></tr>
<tr><td>ALL</td><td>All of the above</td><td>If omitted, USING is reused as WITH CHECK</td></tr>
</table>
<p>Rows hidden by USING are <em>silently</em> filtered (no error, 0 rows). Rows violating WITH CHECK raise <code>new row violates row-level security policy</code>.</p>
<h4>Permissive vs restrictive</h4>
<ul>
<li><strong>Permissive</strong> (default): multiple permissive policies are combined with <strong>OR</strong> - any one can grant access.</li>
<li><strong>Restrictive</strong> (<code>AS RESTRICTIVE</code>): combined with <strong>AND</strong> - every restrictive policy must pass, and there must be at least one permissive policy too, or nothing is visible.</li>
<li>Effective rule: <code>(perm1 OR perm2 ...) AND restr1 AND restr2 ...</code></li>
</ul>
<h4>Who bypasses RLS</h4>
<ul>
<li>Superusers - always.</li>
<li>Roles with <code>BYPASSRLS</code>.</li>
<li>The table owner - unless <code>ALTER TABLE ... FORCE ROW LEVEL SECURITY</code>.</li>
<li>Also note: <code>row_security = off</code> makes queries error instead of silently filtering (used by pg_dump for safety).</li>
</ul>
<div class="callout warn">This in-browser database runs as the superuser <code>postgres</code>, which bypasses RLS. Every runnable example therefore creates a normal role and uses <code>SET ROLE</code> to see policies in action - exactly how your application should connect: as a non-superuser, non-owner role.</div>`,
  why: `<p>Application-level filtering ("remember to add WHERE department_id = ...") fails the first time a developer forgets it, writes a new report, or an attacker finds an injection. RLS moves the rule into the database so every path - API, BI tool, ad-hoc SQL, a newly added endpoint - is filtered consistently. It is essential for multi-tenant SaaS, healthcare (patients per clinician), HR (managers see their reports) and banking data.</p>`,
  useCase: `<p>An HR platform stores all employees of a company in one table. Department heads connect through the app, which sets <code>app.department_id</code>; a permissive policy shows employees of their department; a restrictive policy hides inactive employees from everyone except HR (HR gets its own permissive policy plus an exception). A WITH CHECK clause prevents a manager from moving an employee into another department. The payroll batch job runs as a role with BYPASSRLS on a separate connection.</p>`,
  internals: `<p>Policies are stored in <code>pg_policy</code> (view: <code>pg_policies</code>); <code>pg_class.relrowsecurity</code>/<code>relforcerowsecurity</code> flag the table. During query rewriting PostgreSQL adds the policy expressions as <em>security barrier quals</em> to each reference of the table, so they are evaluated before any user-supplied condition that is not <code>LEAKPROOF</code> (otherwise a user function could observe hidden rows via side effects such as RAISE NOTICE). For UPDATE, the USING expression filters target rows and WITH CHECK is evaluated on the new tuple before it is written. Policies can reference other tables (subqueries) - those tables are themselves subject to their own RLS, and the cost of such subqueries is paid per row unless the planner can turn them into joins/hashes.</p>`,
  whenNot: `<ul><li>Simple column hiding - use column privileges or views.</li>
<li>Very complex per-row logic with heavy subqueries on hot tables - performance may suffer; consider denormalising the access key (e.g. tenant_id on every row) or separate schemas.</li>
<li>When all access goes through a superuser or owner connection - RLS would be bypassed anyway; fix the connection role first.</li></ul>`,
  syntax: `ALTER TABLE t ENABLE ROW LEVEL SECURITY;
ALTER TABLE t FORCE ROW LEVEL SECURITY;          -- also apply to the table owner

CREATE POLICY name ON t
  [ AS { PERMISSIVE | RESTRICTIVE } ]
  [ FOR { ALL | SELECT | INSERT | UPDATE | DELETE } ]
  [ TO { role | PUBLIC | CURRENT_USER | SESSION_USER } [, ...] ]
  [ USING ( expression ) ]                       -- which existing rows
  [ WITH CHECK ( expression ) ];                 -- which new/updated rows

ALTER POLICY name ON t USING (...);
DROP POLICY name ON t;
ALTER TABLE t DISABLE ROW LEVEL SECURITY;
CREATE ROLE ops BYPASSRLS;`,
  examples: [
    { label: 'Basic', title: 'Department heads see only their department',
      sql: `CREATE ROLE dept_head NOLOGIN;
GRANT SELECT ON employees TO dept_head;

ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_department ON employees
  FOR SELECT TO dept_head
  USING (department_id = NULLIF(current_setting('app.department_id', true), '')::int);

SET ROLE dept_head;
SELECT count(*) AS visible_without_context FROM employees;      -- default deny: setting missing

SELECT set_config('app.department_id', '3', false);              -- app sets context per request
SELECT department_id, count(*) AS employees, min(last_name) AS first_name_alpha
FROM employees GROUP BY department_id;
RESET ROLE;

SELECT count(*) AS superuser_sees FROM employees;               -- superuser bypasses RLS`,
      explain: `<p>After <code>ENABLE ROW LEVEL SECURITY</code>, <code>dept_head</code> sees nothing until the policy matches. With no <code>app.department_id</code> set, <code>current_setting(..., true)</code> returns NULL (or an empty string, hence the <code>NULLIF</code>), the comparison is NULL, and zero rows are visible - a safe failure mode. Once the application sets department 3, only that department's rows appear. The superuser (this session after RESET ROLE) still sees all 200 rows.</p>`,
      output: ` visible_without_context
-------------------------
                       0
(1 row)

 department_id | employees | first_name_alpha
---------------+-----------+------------------
             3 |        25 | Agarwal
(1 row)

 superuser_sees
----------------
            200
(1 row)`,
      run: true },
    { label: 'Intermediate', title: 'USING vs WITH CHECK on INSERT and UPDATE',
      sql: `CREATE ROLE dept_head NOLOGIN;
GRANT SELECT, INSERT, UPDATE ON employees TO dept_head;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_department ON employees
  FOR ALL TO dept_head
  USING      (department_id = NULLIF(current_setting('app.department_id', true), '')::int)
  WITH CHECK (department_id = NULLIF(current_setting('app.department_id', true), '')::int);

SELECT set_config('app.department_id', '3', false);
SET ROLE dept_head;

-- USING: rows of other departments are silently skipped (0 rows updated, no error)
UPDATE employees SET job_title = job_title WHERE department_id = 1;

-- WITH CHECK: moving an employee out of department 3 is rejected
DO $$
BEGIN
  UPDATE employees SET department_id = 1
  WHERE id = (SELECT min(id) FROM employees WHERE department_id = 3);
  RAISE NOTICE 'update succeeded (unexpected)';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'blocked by WITH CHECK: %', SQLERRM;
END $$;

-- WITH CHECK: inserting into another department is rejected; own department is fine
DO $$
BEGIN
  INSERT INTO employees (first_name, last_name, email, department_id, job_title, salary, hire_date)
  VALUES ('Eve', 'Intruder', 'eve.intruder@example.com', 1, 'Engineer', 1, current_date);
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'blocked by WITH CHECK: %', SQLERRM;
END $$;
INSERT INTO employees (first_name, last_name, email, department_id, job_title, salary, hire_date)
VALUES ('Nina', 'Newhire', 'nina.newhire@example.com', 3, 'Analyst', 55000, current_date)
RETURNING first_name, department_id;
RESET ROLE;`,
      explain: `<p>USING decides which <em>existing</em> rows a command can touch: the UPDATE targeting department 1 matches nothing for this role and reports <code>UPDATE 0</code>. WITH CHECK validates the <em>resulting</em> row: changing <code>department_id</code> to 1 or inserting a department-1 employee raises <code>new row violates row-level security policy for table "employees"</code> (SQLSTATE 42501, caught here so the script continues). Inserting into the role's own department succeeds. Without WITH CHECK on an UPDATE policy, a user could "push" rows out of their own visibility into someone else's.</p>`,
      output: `UPDATE 0
NOTICE:  blocked by WITH CHECK: new row violates row-level security policy for table "employees"
NOTICE:  blocked by WITH CHECK: new row violates row-level security policy for table "employees"

 first_name | department_id
------------+---------------
 Nina       |             3
(1 row)`,
      run: true },
    { label: 'Advanced', title: 'Permissive OR, restrictive AND, FORCE and BYPASSRLS',
      sql: `CREATE ROLE support NOLOGIN;
CREATE ROLE emp_owner NOLOGIN;
CREATE ROLE auditor NOLOGIN BYPASSRLS;
GRANT SELECT ON users TO support, auditor;
ALTER TABLE users OWNER TO emp_owner;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- permissive policies are OR-ed: tenant 1 rows OR any admin account
CREATE POLICY tenant_one ON users FOR SELECT USING (tenant_id = 1);
CREATE POLICY admins     ON users FOR SELECT USING (role = 'admin');
-- restrictive policy is AND-ed with the result: never show inactive accounts
CREATE POLICY only_active ON users AS RESTRICTIVE FOR SELECT USING (is_active);

SET ROLE support;
SELECT count(*) AS support_sees,
       count(*) FILTER (WHERE tenant_id <> 1) AS admins_of_other_tenants
FROM users;
RESET ROLE;

SET ROLE emp_owner;  SELECT count(*) AS owner_sees_no_force FROM users;  RESET ROLE;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
SET ROLE emp_owner;  SELECT count(*) AS owner_sees_with_force FROM users; RESET ROLE;
SET ROLE auditor;    SELECT count(*) AS bypassrls_sees FROM users;        RESET ROLE;

SELECT policyname, permissive, cmd, qual FROM pg_policies WHERE tablename = 'users' ORDER BY policyname;`,
      explain: `<p>Visible rows = <code>(tenant_id = 1 OR role = 'admin') AND is_active</code>: all active tenant-1 users plus active admins of tenants 2 and 3. The table owner sees every row until <code>FORCE ROW LEVEL SECURITY</code>, after which the owner is filtered like everyone else. A <code>BYPASSRLS</code> role sees all 60 rows regardless (use only for trusted batch/audit jobs). <code>pg_policies</code> documents the result - review it in CI.</p>`,
      output: ` support_sees | admins_of_other_tenants
--------------+-------------------------
           26 |                       7
(1 row)

 owner_sees_no_force
---------------------
                  60
(1 row)

 owner_sees_with_force
-----------------------
                    26
(1 row)

 bypassrls_sees
----------------
             60
(1 row)

 policyname  | permissive  | cmd    | qual
-------------+-------------+--------+------------------------------
 admins      | PERMISSIVE  | SELECT | (role = 'admin'::text)
 only_active | RESTRICTIVE | SELECT | is_active
 tenant_one  | PERMISSIVE  | SELECT | (tenant_id = 1)
(3 rows)`,
      run: true }
  ],
  compare: {
    bad: { sql: `CREATE ROLE dept_head NOLOGIN;
GRANT SELECT, INSERT ON employees TO dept_head;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
CREATE POLICY sel ON employees FOR SELECT USING (department_id = 3);
-- INSERT policy that checks nothing: rows can be planted in any department
CREATE POLICY ins ON employees FOR INSERT WITH CHECK (true);
SET ROLE dept_head;
INSERT INTO employees (first_name, last_name, email, department_id, job_title, salary, hire_date)
VALUES ('Ghost', 'Employee', 'ghost.employee@example.com', 1, 'Engineer', 99999, current_date);
RESET ROLE;
SELECT first_name, last_name, department_id FROM employees WHERE email = 'ghost.employee@example.com';`, why: 'WITH CHECK (true) lets a department-3 head create rows in department 1 - rows they cannot even see afterwards, but which other departments now inherit.', run: true },
    good: { sql: `CREATE ROLE dept_head NOLOGIN;
GRANT SELECT, INSERT ON employees TO dept_head;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
CREATE POLICY dept_all ON employees FOR ALL
  USING (department_id = 3) WITH CHECK (department_id = 3);
SET ROLE dept_head;
DO $$ BEGIN
  INSERT INTO employees (first_name, last_name, email, department_id, job_title, salary, hire_date)
  VALUES ('Ghost', 'Employee', 'ghost.employee@example.com', 1, 'Engineer', 99999, current_date);
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'rejected: %', SQLERRM;
END $$;
RESET ROLE;
SELECT count(*) AS ghost_rows FROM employees WHERE email = 'ghost.employee@example.com';`, why: 'WITH CHECK mirrors USING, so a row can only be written in a state the same role would be allowed to see; the insert into department 1 is rejected (0 ghost rows).', run: true }
  },
  mistakes: [
    'Testing RLS as a superuser or table owner and concluding "it works" (they bypass it).',
    'Enabling RLS without any policy and wondering why the app sees nothing (default deny) - or adding a permissive <code>USING (true)</code> that silently opens everything.',
    'Omitting WITH CHECK on UPDATE/INSERT policies, letting users write rows outside their scope.',
    'Using only restrictive policies - with no permissive policy nothing is visible.',
    'Using <code>current_setting(\'app.x\')</code> without the <code>missing_ok</code> argument - errors when unset; with it, handle empty strings via <code>NULLIF</code>.',
    'Forgetting that views run with the view owner\'s privileges (unless <code>security_invoker = true</code>, PG15+), which can bypass RLS on base tables.'
  ],
  best: [
    'Connect applications as a non-superuser, non-owner role; add <code>FORCE ROW LEVEL SECURITY</code> if the owner can ever log in.',
    'Write FOR ALL policies with matching USING and WITH CHECK unless you deliberately need different rules.',
    'Use permissive policies for "who may see", restrictive ones for global guards (active rows, soft-delete, region).',
    'Keep policy expressions simple and indexable (equality on an indexed column).',
    'Create views with <code>WITH (security_invoker = true)</code> over RLS tables.',
    'Test every policy with SET ROLE in automated tests and review <code>pg_policies</code> in CI.'
  ],
  performance: `<p>The policy expression is added to every query on the table. Equality on an indexed column (<code>department_id</code>, <code>tenant_id</code>) costs almost nothing and can drive an index scan. Policies containing subqueries (<code>EXISTS (SELECT ... FROM memberships ...)</code>) can be expensive - wrap lookups in <code>STABLE</code> functions or cache the result in a session setting. Non-leakproof user conditions are evaluated <em>after</em> the policy, which can prevent index use on them (see the multi-tenancy lesson).</p>`,
  security: `<p>RLS is a strong control only if bypass paths are closed: no superuser/BYPASSRLS/owner connections from apps, <code>SECURITY DEFINER</code> functions reviewed (they run as their owner), views marked <code>security_invoker</code>, and context settings set by trusted code (a client able to run <code>SET app.department_id</code> freely can impersonate other departments - for direct SQL users base policies on <code>current_user</code> or role membership instead).</p>`,
  scenario: { title: 'Managers must see only their own team in a shared employees table', steps: [
    '1. Decide the access key: department_id from the authenticated session.',
    '2. CREATE ROLE app_manager NOLOGIN; GRANT SELECT, UPDATE ON employees; app logins become members.',
    '3. ENABLE RLS; CREATE POLICY FOR ALL TO app_manager USING/WITH CHECK (department_id = current setting).',
    '4. Add a restrictive policy for is_active if inactive employees must stay hidden.',
    '5. Test with SET ROLE + set_config for each department; verify zero rows without context; add the tests to CI.'
  ] },
  widgets: ['lab:security', 'diagram:multi-tenant'],
  interview: [
    { q: 'What is the difference between USING and WITH CHECK?', a: 'USING filters existing rows: which rows are visible to SELECT and which rows UPDATE or DELETE can target, silently skipping others. WITH CHECK validates rows being written by INSERT or the new version of a row in UPDATE, raising an error if the row would violate the policy. For FOR ALL policies without WITH CHECK, USING is reused.' },
    { q: 'How are multiple policies combined?', a: 'Permissive policies are OR-ed together; restrictive policies are AND-ed with that result. At least one permissive policy must allow a row; every restrictive policy must also allow it.' },
    { q: 'Who is not subject to RLS?', a: 'Superusers and roles with BYPASSRLS always bypass it. The table owner bypasses it too unless the table has FORCE ROW LEVEL SECURITY. That is why applications must connect as a non-superuser, non-owner role.' },
    { q: 'Why does a policy-protected table suddenly show all rows through a view?', a: 'Views by default access base tables with the view owner\'s privileges; if the owner bypasses RLS (owner of the table or superuser), the view exposes all rows. Since PostgreSQL 15 create the view WITH (security_invoker = true) so policies are evaluated for the querying user.' }
  ],
  exercises: [
    { task: 'Enable RLS on projects and let role "pm" see only projects with status active or planned. Test it.',
      solution: `CREATE ROLE pm NOLOGIN;
GRANT SELECT ON projects TO pm;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY open_projects ON projects FOR SELECT TO pm USING (status IN ('active', 'planned'));
SET ROLE pm;
SELECT status, count(*) FROM projects GROUP BY status ORDER BY status;
RESET ROLE;`, run: true },
    { task: 'List all RLS policies in the database with their command, roles and expressions.',
      solution: `SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
ORDER BY schemaname, tablename, policyname;`, run: true }
  ],
  challenge: { task: 'On orders, allow role "cs_agent" to SELECT and UPDATE only orders of customers in India, and forbid changing the customer_id of an order to a non-Indian customer. Prove both behaviours.',
    hint: 'Policy USING/WITH CHECK with customer_id IN (SELECT id FROM customers WHERE country = \'India\'); catch the error in a DO block.',
    solution: `CREATE ROLE cs_agent NOLOGIN;
GRANT SELECT, UPDATE ON orders TO cs_agent;
GRANT SELECT ON customers TO cs_agent;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY india_orders ON orders FOR ALL TO cs_agent
  USING      (customer_id IN (SELECT id FROM customers WHERE country = 'India'))
  WITH CHECK (customer_id IN (SELECT id FROM customers WHERE country = 'India'));
SET ROLE cs_agent;
SELECT count(*) AS visible_orders,
       count(DISTINCT c.country) AS countries
FROM orders o JOIN customers c ON c.id = o.customer_id;
DO $$ BEGIN
  UPDATE orders SET customer_id = (SELECT min(id) FROM customers WHERE country = 'USA')
  WHERE id = (SELECT min(id) FROM orders);
  RAISE NOTICE 'update passed';
EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'rejected: %', SQLERRM;
END $$;
RESET ROLE;`, run: true },
  related: ['row-level-security-multi-tenant-saas', 'roles-permissions-least-privilege', 'views', 'security'],
  quiz: [
    { type: 'tf', q: 'After ENABLE ROW LEVEL SECURITY with no policies, a normal role with SELECT sees all rows.', answer: false, explain: 'RLS is default-deny: no policy means no rows (for roles subject to RLS).' },
    { type: 'mcq', q: 'Two permissive policies A and B plus restrictive R. Visible rows?', options: ['A AND B AND R', '(A OR B) AND R', 'A OR B OR R', '(A AND B) OR R'], answer: 1, explain: 'Permissive policies are OR-ed; restrictive are AND-ed.' },
    { type: 'predict', q: 'A role updates a row it cannot see under USING. Result?', code: `UPDATE t SET v = 1 WHERE id = 42;  -- row 42 hidden by USING`, options: ['ERROR: policy violation', 'UPDATE 0', 'UPDATE 1', 'Deadlock'], answer: 1, explain: 'USING silently filters target rows; only WITH CHECK violations raise errors.' },
    { type: 'bug', q: 'Why does the table owner still see every tenant?', code: `ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY t ON invoices USING (tenant_id = current_setting('app.tenant_id')::int);
-- app connects as the table owner`, options: ['Policy syntax error', 'Owners bypass RLS unless FORCE ROW LEVEL SECURITY', 'Needs BYPASSRLS', 'current_setting is volatile'], answer: 1, explain: 'Use FORCE ROW LEVEL SECURITY or (better) connect as a non-owner role.' },
    { type: 'mcq', q: 'Which SQLSTATE/class is raised for a WITH CHECK violation?', options: ['23505 unique_violation', '42501 insufficient_privilege', '40001 serialization_failure', '22P02 invalid_text_representation'], answer: 1, explain: 'new row violates row-level security policy is reported as 42501.' }
  ]
},
/* ------------------------------------------------------------------ */
{
  id: 'row-level-security-multi-tenant-saas',
  module: 'row-level-security',
  title: 'Multi-Tenant SaaS with tenant_id and current_setting(\'app.tenant_id\')',
  level: 4,
  minutes: 28,
  summary: 'Isolate tenants in shared tables: tenant_id on every row, an app role subject to RLS, set_config per request/transaction, WITH CHECK against cross-tenant writes, and role-based rules inside a tenant - tested on company_db users.',
  objectives: [
    'Implement tenant isolation on company_db users with a tenant policy',
    'Set and scope tenant context with set_config / SET LOCAL safely (poolers!)',
    'Prove isolation with SET ROLE for each tenant, including the "no context" case',
    'Block cross-tenant INSERT/UPDATE with WITH CHECK',
    'Layer in-tenant role rules (admins see all, viewers see only themselves)',
    'Wrap context in helper functions for readability'
  ],
  concept: `<p>In the <strong>shared schema</strong> model every tenant's rows live in the same tables, distinguished by a <code>tenant_id</code> column. The application authenticates the end user, knows their tenant, and tells PostgreSQL via a custom setting; RLS policies compare each row's <code>tenant_id</code> with that setting.</p>
<p><strong>Analogy - a co-working space.</strong> All companies share the same building and the same filing room (tables). Each visitor gets a wristband with their company's colour (the session setting). The smart cabinets (RLS) open only folders with the matching colour. The receptionist (application) puts the wristband on at the door; the cabinets enforce it, even if a visitor wanders into the wrong room.</p>
<h4>The moving parts</h4>
<ol>
<li><strong>Column</strong>: <code>tenant_id int NOT NULL</code> on every tenant-owned table (company_db <code>users</code> already has tenants 1-3, 20 users each).</li>
<li><strong>Role</strong>: the app connects as e.g. <code>saas_app</code> - not superuser, not owner, no BYPASSRLS.</li>
<li><strong>Context</strong>: per request, inside the transaction: <code>SELECT set_config('app.tenant_id', '42', true)</code> (= <code>SET LOCAL app.tenant_id = '42'</code>). Custom settings need a dotted name (<code>app.*</code>).</li>
<li><strong>Policy</strong>: <code>USING (tenant_id = current_setting('app.tenant_id', true)::int)</code> plus the same WITH CHECK.</li>
<li><strong>Index</strong>: <code>tenant_id</code> leading in indexes (<code>(tenant_id, created_at)</code>, <code>(tenant_id, email)</code>), since every query now filters by it.</li>
</ol>
<h4>Scoping the setting correctly</h4>
<ul>
<li><code>set_config(name, value, is_local => true)</code> / <code>SET LOCAL</code>: lasts until the end of the current transaction - safe with PgBouncer transaction pooling.</li>
<li><code>set_config(..., false)</code> / <code>SET</code>: lasts for the session - with poolers it can leak to the next client; only safe with dedicated connections (and still reset it).</li>
<li>Gotcha: after a transaction-local value ends, the placeholder exists with an <em>empty string</em>, so <code>current_setting('app.tenant_id', true)::int</code> fails with "invalid input syntax for type integer". Use <code>NULLIF(current_setting('app.tenant_id', true), '')::int</code>.</li>
<li>The runnable examples below use session scope (<code>false</code>) so the setting survives between statements of the demo; your application should use transaction scope.</li>
</ul>`,
  why: `<p>Shared-schema multi-tenancy is the most cost-efficient SaaS model (one schema to migrate, one connection pool, thousands of tenants), but a single missing <code>WHERE tenant_id = ?</code> leaks one customer's data to another - a business-ending incident. RLS makes isolation a property of the database rather than of every query a developer writes.</p>`,
  useCase: `<p>A project-management SaaS with 12,000 tenants on one PostgreSQL cluster: 40 tables carry <code>tenant_id</code>; each has a policy <code>tenant_id = app_tenant()</code> where <code>app_tenant()</code> is a <code>STABLE</code> SQL function reading the setting. The API middleware opens a transaction, runs <code>SET LOCAL app.tenant_id</code> and <code>SET LOCAL app.user_id</code>, executes the request and commits. A nightly CI job runs every endpoint as tenant A against fixture data of tenant B and asserts zero leakage.</p>`,
  internals: `<p>Custom GUCs (<code>app.tenant_id</code>) are "placeholder" variables: any dotted name can be set without prior definition. <code>current_setting()</code> is <code>STABLE</code>, so within one statement it is evaluated once and the policy predicate behaves like a constant, enabling index scans on <code>tenant_id</code> and partition pruning (at executor start-up). For INSERT, WITH CHECK evaluates the new row; a column default such as <code>DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::int</code> can fill tenant_id automatically so the app never sends it. Unique constraints should include tenant_id (<code>UNIQUE (tenant_id, email)</code>) - otherwise uniqueness errors reveal that a value exists in another tenant (a side channel).</p>`,
  whenNot: `<ul><li>Tenants needing physical isolation (separate encryption keys, data residency, custom extensions, per-tenant restore) - use database-per-tenant or dedicated clusters.</li>
<li>When end users connect with their own database credentials and can run <code>SET app.tenant_id</code> themselves - base policies on <code>current_user</code>/role membership instead of a client-settable value.</li></ul>`,
  syntax: `-- per table
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON users
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::int)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::int);
CREATE INDEX ON users (tenant_id);

-- per request (application, inside a transaction)
BEGIN;
SELECT set_config('app.tenant_id', $1, true);   -- or: SET LOCAL app.tenant_id = '42';
... queries ...
COMMIT;`,
  examples: [
    { label: 'Basic', title: 'Tenant isolation on company_db users',
      sql: `CREATE ROLE saas_app NOLOGIN;               -- the application's role (not superuser, not owner)
GRANT SELECT, INSERT, UPDATE ON users TO saas_app;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON users
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::int)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::int);

SET ROLE saas_app;
SELECT count(*) AS rows_without_tenant_context FROM users;

SELECT set_config('app.tenant_id', '2', false);    -- request for tenant 2
SELECT tenant_id, role, count(*) AS users
FROM users GROUP BY tenant_id, role ORDER BY role;

SELECT set_config('app.tenant_id', '3', false);    -- next request, tenant 3
SELECT tenant_id, count(*) AS users, min(username) AS sample
FROM users GROUP BY tenant_id;
RESET ROLE;`,
      explain: `<p>The same unchanged query returns different rows depending only on the tenant context. Without context the predicate is <code>tenant_id = NULL</code> - no rows, never "all rows". Note that the queries contain no <code>WHERE tenant_id</code> at all; even a developer who forgets it cannot leak data. We <code>SET ROLE saas_app</code> because this sandbox session is a superuser, which would bypass RLS.</p>`,
      output: ` rows_without_tenant_context
-----------------------------
                           0
(1 row)

 tenant_id | role    | users
-----------+---------+-------
         2 | admin   |     4
         2 | analyst |     4
         2 | manager |     4
         2 | viewer  |     8
(4 rows)

 tenant_id | users | sample
-----------+-------+--------
         3 |    20 | user11
(1 row)`,
      run: true },
    { label: 'Intermediate', title: 'Cross-tenant writes blocked by WITH CHECK; tenant_id defaulted from context',
      sql: `CREATE ROLE saas_app NOLOGIN;
GRANT SELECT, INSERT, UPDATE ON users TO saas_app;
ALTER TABLE users ALTER COLUMN tenant_id SET DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::int;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON users
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::int)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::int);

SELECT set_config('app.tenant_id', '2', false);
SET ROLE saas_app;

-- tenant_id omitted: filled from the context by the column default
INSERT INTO users (username, email, password_hash, role)
VALUES ('t2_newbie', 't2_newbie@example.com', 'x', 'viewer')
RETURNING username, tenant_id;

-- attempt to plant a row in tenant 3, and to move a tenant-2 user to tenant 1
DO $$
BEGIN
  BEGIN
    INSERT INTO users (username, email, password_hash, role, tenant_id)
    VALUES ('spy', 'spy@example.com', 'x', 'admin', 3);
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'insert blocked: %', SQLERRM;
  END;
  BEGIN
    UPDATE users SET tenant_id = 1 WHERE username = 't2_newbie';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'update blocked: %', SQLERRM;
  END;
END $$;

-- updating a tenant-1 user is silently impossible (row not visible)
UPDATE users SET is_active = false WHERE tenant_id = 1;
SELECT count(*) AS tenant2_rows_visible FROM users;
RESET ROLE;`,
      explain: `<p>The column default reads the same context, so application code cannot "forget" the tenant on insert. The WITH CHECK clause rejects an explicit foreign tenant on INSERT and a tenant change on UPDATE (both SQLSTATE 42501, caught in nested blocks so the demo continues). The UPDATE aimed at tenant 1 affects 0 rows because USING hides those rows. Tenant 2 now has 21 users including the new one.</p>`,
      output: ` username  | tenant_id
-----------+-----------
 t2_newbie |         2
(1 row)

NOTICE:  insert blocked: new row violates row-level security policy for table "users"
NOTICE:  update blocked: new row violates row-level security policy for table "users"
UPDATE 0

 tenant2_rows_visible
----------------------
                   21
(1 row)`,
      run: true },
    { label: 'Advanced', title: 'Tenant + in-tenant roles: admins see the tenant, viewers see themselves',
      sql: `CREATE ROLE saas_app NOLOGIN;
GRANT SELECT ON users TO saas_app;

-- helper functions make policies readable; STABLE so they are evaluated once per statement
CREATE FUNCTION app_tenant() RETURNS int LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::int $$;
CREATE FUNCTION app_user()   RETURNS int LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::int $$;
CREATE FUNCTION app_role()   RETURNS text LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.user_role', true), '') $$;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
-- hard boundary: always restricted to the tenant
CREATE POLICY tenant_boundary ON users AS RESTRICTIVE USING (tenant_id = app_tenant());
-- inside the tenant: admins/managers see everyone, others only themselves
CREATE POLICY staff_see_all ON users FOR SELECT USING (app_role() IN ('admin', 'manager'));
CREATE POLICY see_self      ON users FOR SELECT USING (id = app_user());

SET ROLE saas_app;
-- request 1: user 5 (an admin of tenant 3)
SELECT set_config('app.tenant_id', '3', false), set_config('app.user_id', '5', false), set_config('app.user_role', 'admin', false);
SELECT 'admin user5' AS caller, count(*) AS visible, min(tenant_id) AS t_min, max(tenant_id) AS t_max FROM users;
-- request 2: user 8 (a viewer of tenant 3)
SELECT set_config('app.user_id', '8', false), set_config('app.user_role', 'viewer', false);
SELECT 'viewer user8' AS caller, count(*) AS visible, min(username) AS only_row FROM users;
-- request 3: forged: viewer claims user id 3, which belongs to tenant 1
SELECT set_config('app.user_id', '3', false);
SELECT 'forged id' AS caller, count(*) AS visible FROM users;
RESET ROLE;`,
      explain: `<p>The restrictive <code>tenant_boundary</code> is AND-ed with everything, so no in-tenant rule can ever cross tenants. The two permissive policies are OR-ed: staff see the whole tenant, everyone sees their own row. The forged request (user id from another tenant) sees nothing because the restrictive tenant check still applies. Helper functions keep policies short; mark them <code>STABLE</code> (not VOLATILE) so the planner can treat their results as constants per statement.</p>`,
      output: ` caller      | visible | t_min | t_max
-------------+---------+-------+-------
 admin user5 |      20 |     3 |     3
(1 row)

 caller       | visible | only_row
--------------+---------+----------
 viewer user8 |       1 | user8
(1 row)

 caller    | visible
-----------+---------
 forged id |       0
(1 row)`,
      run: true }
  ],
  compare: {
    bad: { sql: `CREATE ROLE saas_app NOLOGIN;
GRANT SELECT ON users TO saas_app;
SET ROLE saas_app;
-- isolation by convention: this report forgot the tenant filter
SELECT count(*) AS users_visible, count(DISTINCT tenant_id) AS tenants_leaked FROM users;
RESET ROLE;`, why: 'Without RLS every query must remember WHERE tenant_id = ?; one forgotten filter exposes all 3 tenants.', run: true },
    good: { sql: `CREATE ROLE saas_app NOLOGIN;
GRANT SELECT ON users TO saas_app;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON users
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::int);
SELECT set_config('app.tenant_id', '1', false);
SET ROLE saas_app;
SELECT count(*) AS users_visible, count(DISTINCT tenant_id) AS tenants_leaked FROM users;   -- same query
RESET ROLE;`, why: 'The identical query is now limited to one tenant by the database itself.', run: true }
  },
  mistakes: [
    'Using session-level <code>SET app.tenant_id</code> with a transaction-pooling PgBouncer - the setting leaks to other clients sharing the server connection.',
    '<code>current_setting(\'app.tenant_id\')::int</code> without <code>missing_ok</code> and <code>NULLIF</code> - errors on unset or empty values (the empty-string trap after SET LOCAL ends).',
    'Global UNIQUE constraints (e.g. on email) in a multi-tenant table - leaks existence across tenants and blocks legitimate duplicates; use <code>UNIQUE (tenant_id, email)</code>.',
    'Forgetting RLS on child tables (invoices, comments, attachments) - every tenant-owned table needs its own policy.',
    'Letting the tenant id come from the client request body rather than the authenticated session/token.',
    'Marking context helper functions VOLATILE - prevents index usage and constant folding.'
  ],
  best: [
    'tenant_id NOT NULL on every tenant-owned table, leading column of indexes and unique constraints.',
    'One app role without BYPASSRLS; set tenant context with <code>SET LOCAL</code>/<code>set_config(..., true)</code> at the start of each transaction.',
    'Policies: restrictive tenant boundary + permissive in-tenant rules; identical USING and WITH CHECK for the tenant column.',
    'Default <code>tenant_id</code> from the context; never trust a client-supplied tenant id.',
    'Automated cross-tenant leakage tests for every endpoint and table.'
  ],
  performance: `<p>With <code>tenant_id</code> indexed (or leading composite indexes), the policy predicate is an index condition, so RLS adds near-zero overhead. Watch for: policies calling VOLATILE functions (evaluated per row), subqueries in policies, and non-leakproof user predicates that cannot be pushed below the policy (covered in the next lesson). For very large tenants, partition by tenant to get partition pruning plus smaller indexes.</p>`,
  security: `<p>The tenant context must be set only by trusted server code after authentication. If any untrusted party can run arbitrary SQL as the app role, they can also run <code>SET app.tenant_id</code> - in that case derive identity from <code>current_user</code> (one DB role per tenant) or sign the context. Audit <code>pg_policies</code> and <code>relrowsecurity</code> in CI so a migration cannot silently drop isolation.</p>`,
  scenario: { title: 'Customer reports seeing another company\'s project names', steps: [
    '1. Contain: identify the endpoint; check its query path and connection role (superuser? owner? BYPASSRLS?).',
    '2. Check the table: relrowsecurity, relforcerowsecurity and its pg_policies entries.',
    '3. Check context handling: was SET (session) used with transaction pooling? Was tenant id taken from user input?',
    '4. Fix: non-owner app role, SET LOCAL per transaction, RLS on every tenant table, tenant-scoped unique constraints.',
    '5. Add an automated isolation test suite and notify affected customers per your incident policy.'
  ] },
  widgets: ['diagram:multi-tenant', 'lab:security'],
  interview: [
    { q: 'How do you implement multi-tenant isolation with RLS?', a: 'Add tenant_id to every tenant-owned table, connect as a non-superuser non-owner app role, set the tenant per transaction with SET LOCAL or set_config(..., true), and create policies USING and WITH CHECK tenant_id = current_setting(\'app.tenant_id\', true)::int. Index tenant_id and test isolation automatically.' },
    { q: 'Why SET LOCAL instead of SET for the tenant id?', a: 'SET LOCAL scopes the value to the current transaction. With transaction pooling (PgBouncer), consecutive transactions on a server connection can belong to different clients, so a session-level SET could leak one tenant\'s context to another client.' },
    { q: 'What is the empty-string trap with current_setting?', a: 'After a transaction-local custom setting goes out of scope, the placeholder remains defined with an empty string, so current_setting(\'app.tenant_id\', true) returns \'\' rather than NULL and casting to int throws. Wrap it in NULLIF(..., \'\') to get NULL and therefore no rows.' },
    { q: 'How do you combine tenant isolation with in-tenant roles?', a: 'Make the tenant check a RESTRICTIVE policy so it is always AND-ed, and express in-tenant rules (admins see all, users see their own rows) as PERMISSIVE policies that are OR-ed together. No permissive rule can then cross the tenant boundary.' }
  ],
  exercises: [
    { task: 'With RLS on users for tenant isolation, show the count of active users per role for tenant 1 as the app role.',
      solution: `CREATE ROLE saas_app NOLOGIN;
GRANT SELECT ON users TO saas_app;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON users USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::int);
SELECT set_config('app.tenant_id', '1', false);
SET ROLE saas_app;
SELECT role, count(*) FILTER (WHERE is_active) AS active_users FROM users GROUP BY role ORDER BY role;
RESET ROLE;`, run: true },
    { task: 'Demonstrate the transaction-local behaviour: set app.tenant_id with is_local = true inside a transaction and show the value inside and after COMMIT.',
      solution: `BEGIN;
SELECT set_config('app.tenant_id', '2', true);
SELECT current_setting('app.tenant_id', true) AS inside_txn;
COMMIT;
SELECT current_setting('app.tenant_id', true) AS after_commit,   -- '' (empty), not NULL
       NULLIF(current_setting('app.tenant_id', true), '') AS safe_value;`, run: true }
  ],
  challenge: { task: 'Create a tenant-scoped table "tenant_notes" whose tenant_id defaults from the context, with a tenant-scoped UNIQUE (tenant_id, title), RLS, and prove that two tenants can both create a note titled "Kickoff" while each sees only its own.',
    hint: 'DEFAULT NULLIF(current_setting(...), \'\')::int; switch set_config between inserts while SET ROLE app.',
    solution: `CREATE TABLE tenant_notes (
  id        int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id int NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::int,
  title     text NOT NULL,
  UNIQUE (tenant_id, title)
);
CREATE ROLE notes_app NOLOGIN;
GRANT SELECT, INSERT ON tenant_notes TO notes_app;
ALTER TABLE tenant_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tn ON tenant_notes
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::int)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::int);
SET ROLE notes_app;
SELECT set_config('app.tenant_id', '1', false);
INSERT INTO tenant_notes (title) VALUES ('Kickoff');
SELECT set_config('app.tenant_id', '2', false);
INSERT INTO tenant_notes (title) VALUES ('Kickoff');
SELECT tenant_id, title FROM tenant_notes;      -- tenant 2 sees only its note
RESET ROLE;
SELECT tenant_id, title FROM tenant_notes ORDER BY tenant_id;   -- superuser sees both`, run: true },
  related: ['row-level-security-policies', 'row-level-security-tenancy-models', 'ai-rag-production', 'roles-permissions'],
  quiz: [
    { type: 'mcq', q: 'Safest way to set the tenant per request behind PgBouncer transaction pooling?', options: ['SET app.tenant_id = \'5\' after connecting', 'SET LOCAL app.tenant_id = \'5\' inside the transaction', 'ALTER ROLE app SET app.tenant_id = \'5\'', 'Pass tenant_id in every WHERE'], answer: 1, explain: 'Transaction-local settings cannot leak to other clients.' },
    { type: 'predict', q: 'App role, RLS tenant policy with NULLIF, no app.tenant_id ever set. SELECT count(*) FROM users returns?', code: `SELECT count(*) FROM users;`, options: ['60', '0', 'ERROR', '20'], answer: 1, explain: 'The predicate compares with NULL - no rows are visible.' },
    { type: 'tf', q: 'A global UNIQUE(email) in a shared multi-tenant table can reveal that an email exists in another tenant.', answer: true, explain: 'The unique violation is a side channel; use UNIQUE (tenant_id, email).' },
    { type: 'bug', q: 'Find the bug', code: `CREATE POLICY p ON invoices USING (tenant_id = current_setting('app.tenant_id')::int);
-- connections use SET LOCAL; queries outside a transaction fail with
-- ERROR: invalid input syntax for type integer: ""`, options: ['Needs FORCE RLS', 'Use NULLIF(current_setting(\'app.tenant_id\', true), \'\')::int', 'Use VOLATILE', 'Use BYPASSRLS'], answer: 1, explain: 'After SET LOCAL ends the setting is an empty string; NULLIF and missing_ok make it safe.' }
  ]
},
/* ------------------------------------------------------------------ */
{
  id: 'row-level-security-tenancy-models',
  module: 'row-level-security',
  title: 'Multi-Tenancy Models: Database vs Schema vs Shared Table, Partitioning, Sharding, RLS Performance',
  level: 5,
  minutes: 28,
  summary: 'Compare database-per-tenant, schema-per-tenant and shared-schema designs, add tenant partitioning and sharding, and make RLS fast with tenant_id indexes and leakproof-aware predicates.',
  objectives: [
    'Compare isolation, cost, operations and scale of the three tenancy models',
    'Know when to add tenant partitioning or sharding (e.g. Citus extension)',
    'Implement schema-per-tenant with search_path and shared-table partitioning with RLS',
    'Index tenant_id correctly and read RLS plans',
    'Explain LEAKPROOF and why some predicates cannot use indexes under RLS',
    'Choose a model for a given SaaS scenario'
  ],
  concept: `<p>There are three basic ways to host many tenants in PostgreSQL, plus two scaling techniques on top of the shared model.</p>
<p><strong>Analogy - housing.</strong> Database-per-tenant is detached houses (maximum privacy, every house needs its own plumbing and maintenance). Schema-per-tenant is apartments in one building (separate rooms, shared foundation and utilities). Shared schema with tenant_id is a hotel (everyone shares the same rooms layout and corridors; key cards - RLS - keep guests apart). Partitioning gives each big guest a private floor; sharding spreads guests over several hotels.</p>
<table>
<tr><th></th><th>Database per tenant</th><th>Schema per tenant</th><th>Shared schema + tenant_id (+RLS)</th></tr>
<tr><td>Isolation</td><td>Strongest (separate catalogs, can be separate clusters)</td><td>Good (separate tables; same cluster)</td><td>Logical only - relies on RLS/app code</td></tr>
<tr><td>Tenants per cluster</td><td>Tens to low hundreds</td><td>Hundreds to a few thousand (catalog bloat beyond)</td><td>Thousands to millions</td></tr>
<tr><td>Migrations</td><td>Run N times</td><td>Run N times (per schema)</td><td>Run once</td></tr>
<tr><td>Connections / pooling</td><td>Pool per database - hard at scale</td><td>One pool; set search_path per request</td><td>One pool</td></tr>
<tr><td>Per-tenant backup/restore, residency</td><td>Easy (pg_dump -d, separate cluster per region)</td><td>Possible (pg_dump -n)</td><td>Hard (filtered export)</td></tr>
<tr><td>Cross-tenant analytics</td><td>Hard (FDW, ETL)</td><td>UNION across schemas</td><td>Trivial (GROUP BY tenant_id, with a bypass role)</td></tr>
<tr><td>Noisy neighbours</td><td>Isolatable</td><td>Shared resources</td><td>Shared resources</td></tr>
<tr><td>Typical fit</td><td>Few large enterprise/regulated tenants</td><td>Moderate B2B tenant counts</td><td>SaaS with many small/medium tenants</td></tr>
</table>
<h4>Scaling the shared model</h4>
<ul>
<li><strong>Tenant partitioning</strong> <span class="tag core">core</span>: <code>PARTITION BY LIST (tenant_id)</code> for a few huge tenants (plus a DEFAULT partition) or <code>PARTITION BY HASH (tenant_id)</code> to split many tenants into N buckets. Gives partition pruning, smaller indexes, per-partition VACUUM, and the ability to detach/move a tenant's partition.</li>
<li><strong>Tenant sharding</strong>: distribute tenants across nodes. Options: application-level routing (tenant -&gt; shard map), or <span class="tag ext">extension</span> <strong>Citus</strong> (distributed tables with <code>create_distributed_table('orders', 'tenant_id')</code>; co-located joins on tenant_id; Citus is an extension/distributed database, not native partitioning). A hybrid is common: most tenants on shared shards, the largest tenants isolated.</li>
</ul>
<h4>RLS performance</h4>
<ul>
<li>Index <code>tenant_id</code>, ideally as the <em>leading</em> column of composite indexes that match your queries: <code>(tenant_id, created_at)</code>, <code>(tenant_id, status)</code>.</li>
<li>Policy predicates are security-barrier quals: user conditions using <strong>non-LEAKPROOF</strong> functions/operators are evaluated <em>after</em> them and cannot be used as index conditions ahead of the policy. Built-in equality operators (<code>int4eq</code>, <code>texteq</code>) are leakproof; <code>LIKE</code>, <code>lower()</code>, most casts and user functions are not.</li>
<li>Only superusers can mark functions LEAKPROOF - do so only if the function cannot reveal its arguments via errors or side effects.</li>
<li>Keep policies cheap: no per-row subqueries; use STABLE helper functions and settings.</li>
</ul>`,
  why: `<p>The tenancy model is one of the hardest decisions to reverse in a SaaS product: it shapes security posture, migration tooling, cost per tenant, compliance options and how far a single cluster scales. Knowing the trade-offs (and the escape hatches - partitioning, sharding, moving big tenants out) avoids painful re-architecture later.</p>`,
  useCase: `<p>A B2B analytics SaaS started with schema-per-tenant; at 4,000 tenants the catalog held 600,000 relations, migrations took 9 hours and <code>pg_dump</code> struggled. They moved to a shared schema with tenant_id + RLS, hash-partitioned the three biggest tables into 64 partitions by tenant_id, and isolated their five largest enterprise customers on dedicated databases (contractual requirement). Later, growth pushed them to Citus with tenant_id as the distribution column - the shared-schema design made that move straightforward.</p>`,
  internals: `<p>Schema-per-tenant multiplies catalog entries (every table, index, sequence, TOAST table per tenant) - <code>pg_class</code> and <code>pg_attribute</code> grow large, relcache/catcache memory per backend grows, and planning/autovacuum overhead increases. In the shared model, RLS quals are added during rewrite with <code>security_barrier</code> semantics: the planner may push a user qual below (before) the policy qual only if all its functions are leakproof; otherwise it keeps it above. With <code>current_setting()</code> being STABLE, partition pruning on <code>tenant_id</code> happens at executor start-up ("Subplans Removed" in EXPLAIN). Citus rewrites queries filtered by the distribution column to a single shard (router queries).</p>`,
  whenNot: `<ul><li>Do not choose schema-per-tenant for an expected 10,000+ tenants.</li>
<li>Do not choose database-per-tenant when you need cheap self-serve sign-ups for thousands of small customers.</li>
<li>Do not shard before you need to - a single well-tuned node with partitioning handles a lot; sharding adds operational complexity.</li></ul>`,
  syntax: `-- schema per tenant
CREATE SCHEMA tenant_acme;  CREATE TABLE tenant_acme.projects (...);
SET search_path = tenant_acme;                       -- per request (SET LOCAL in a transaction)

-- shared schema + tenant partitioning + RLS
CREATE TABLE events (tenant_id int NOT NULL, id bigint, created_at timestamptz, payload jsonb)
  PARTITION BY HASH (tenant_id);
CREATE TABLE events_p0 PARTITION OF events FOR VALUES WITH (MODULUS 4, REMAINDER 0);  -- ... p1..p3
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
CREATE POLICY t ON events USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::int);
CREATE INDEX ON events (tenant_id, created_at);

-- sharding with the Citus extension
SELECT create_distributed_table('events', 'tenant_id');`,
  examples: [
    { label: 'Basic', title: 'Schema per tenant with search_path',
      sql: `CREATE SCHEMA tenant_acme;
CREATE SCHEMA tenant_globex;
CREATE TABLE tenant_acme.projects   (id int PRIMARY KEY, name text NOT NULL);
CREATE TABLE tenant_globex.projects (id int PRIMARY KEY, name text NOT NULL);
INSERT INTO tenant_acme.projects   VALUES (1, 'Acme ERP rollout');
INSERT INTO tenant_globex.projects VALUES (1, 'Globex CRM'), (2, 'Globex BI');

-- request for Globex: unqualified names resolve to its schema
SET search_path = tenant_globex, public;
SELECT current_schema() AS tenant_schema, id, name FROM projects ORDER BY id;
RESET search_path;

-- the cost: one copy of every relation per tenant
SELECT n.nspname, count(*) AS relations
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname LIKE 'tenant\\_%'
GROUP BY n.nspname ORDER BY 1;`,
      explain: `<p>Each tenant gets identical tables in its own schema; the app sets <code>search_path</code> per request (use <code>SET LOCAL</code> with poolers) so the same unqualified SQL hits the right tenant. Isolation is structural: a forgotten WHERE cannot leak rows. The catalog query shows the cost - every table brings its own index (and TOAST) relations, multiplied by the number of tenants; at thousands of tenants this hurts migrations, backups and memory.</p>`,
      output: ` tenant_schema | id | name
---------------+----+------------
 tenant_globex |  1 | Globex CRM
 tenant_globex |  2 | Globex BI
(2 rows)

 nspname       | relations
---------------+-----------
 tenant_acme   |         2
 tenant_globex |         2
(2 rows)`,
      run: true },
    { label: 'Intermediate', title: 'Shared table, LIST-partitioned by tenant, protected by RLS',
      sql: `CREATE TABLE tenant_events (
  tenant_id  int NOT NULL,
  id         int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  kind       text NOT NULL
) PARTITION BY LIST (tenant_id);
CREATE TABLE tenant_events_t1 PARTITION OF tenant_events FOR VALUES IN (1);
CREATE TABLE tenant_events_t2 PARTITION OF tenant_events FOR VALUES IN (2);
CREATE TABLE tenant_events_other PARTITION OF tenant_events DEFAULT;
INSERT INTO tenant_events (tenant_id, id, kind)
SELECT 1 + g % 4, g, (ARRAY['login','export','invite'])[1 + g % 3] FROM generate_series(1, 400) g;
CREATE INDEX ON tenant_events (tenant_id, created_at);

CREATE ROLE events_app NOLOGIN;
GRANT SELECT ON tenant_events TO events_app;
ALTER TABLE tenant_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_events
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::int);

SELECT set_config('app.tenant_id', '2', false);
SET ROLE events_app;
EXPLAIN (COSTS OFF) SELECT kind, count(*) FROM tenant_events GROUP BY kind;
SELECT kind, count(*) FROM tenant_events GROUP BY kind ORDER BY kind;
RESET ROLE;`,
      explain: `<p>The RLS predicate compares <code>tenant_id</code> with a STABLE expression, so PostgreSQL prunes partitions at executor start-up: "Subplans Removed: 2" means only tenant 2's partition is scanned. Big tenants get their own partitions (and can later be detached and moved to a dedicated server), small ones share the DEFAULT (or HASH) partitions. The query itself has no tenant filter - RLS supplies it.</p>`,
      output: `GroupAggregate
  Group Key: tenant_events.kind
  ->  Sort
        Sort Key: tenant_events.kind
        ->  Append
              Subplans Removed: 2
              ->  Seq Scan on tenant_events_t2 tenant_events_1
                    Filter: (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::integer)

 kind   | count
--------+-------
 export |    34
 invite |    33
 login  |    33
(3 rows)`,
      run: true },
    { label: 'Advanced', title: 'RLS performance: tenant_id index and LEAKPROOF predicates',
      sql: `CREATE ROLE saas_app NOLOGIN;
GRANT SELECT ON users TO saas_app;
CREATE INDEX users_tenant_idx ON users (tenant_id);
ANALYZE users;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON users
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::int);

SELECT set_config('app.tenant_id', '2', false);
SET ROLE saas_app;
SET enable_seqscan = off;     -- tiny table: force the planner to show index choices

-- 1) leakproof operator (texteq): user qual may run first -> unique index on username
EXPLAIN (COSTS OFF) SELECT id FROM users WHERE username = 'user4';

-- 2) non-leakproof function (lower): must run AFTER the policy -> cannot lead
EXPLAIN (COSTS OFF) SELECT id FROM users WHERE lower(username) = 'user4';

-- 3) plain listing: the policy itself becomes the index condition on tenant_id
EXPLAIN (COSTS OFF) SELECT id FROM users;
RESET enable_seqscan;
RESET ROLE;

SELECT DISTINCT proname, proleakproof FROM pg_proc
WHERE proname IN ('texteq', 'int4eq', 'textlike', 'lower') ORDER BY proname;`,
      explain: `<p>(1) <code>username = 'user4'</code> uses <code>texteq</code>, which is LEAKPROOF, so the planner may evaluate it before the policy and use the unique index on <code>username</code>; the policy becomes a Filter. (2) <code>lower()</code> is not leakproof: evaluating it on hidden rows could leak them via errors, so it must run after the policy - it cannot drive an index ahead of the RLS qual. (3) With no user predicate, the policy's <code>tenant_id = ...</code> becomes the <code>Index Cond</code> on <code>users_tenant_idx</code>. Lesson: always index tenant_id (leading), and prefer predicates built from leakproof operators on hot paths.</p>`,
      output: `Index Scan using users_username_key on users
  Index Cond: (username = 'user4'::text)
  Filter: (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::integer)

Index Scan using users_tenant_idx on users
  Index Cond: (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::integer)
  Filter: (lower(username) = 'user4'::text)

Index Scan using users_tenant_idx on users
  Index Cond: (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::integer)

 proname  | proleakproof
----------+--------------
 int4eq   | t
 lower    | f
 texteq   | t
 textlike | f
(4 rows)`,
      run: true }
  ],
  compare: {
    bad: { sql: `CREATE ROLE saas_app NOLOGIN;
GRANT SELECT ON users, departments TO saas_app;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
-- policy with a VOLATILE helper and a per-row subquery
CREATE FUNCTION current_tenant_slow() RETURNS int LANGUAGE sql VOLATILE
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::int $$;
CREATE POLICY slow_policy ON users
  USING (tenant_id = current_tenant_slow()
         AND EXISTS (SELECT 1 FROM departments d WHERE d.id = users.tenant_id));   -- per-row lookup
SELECT set_config('app.tenant_id', '2', false);
SET ROLE saas_app;
EXPLAIN (COSTS OFF) SELECT count(*) FROM users;
RESET ROLE;`, why: 'No tenant_id index means a Seq Scan for every tenant, and the EXISTS lookup adds a SubPlan to every row\'s filter. VOLATILE helpers that cannot be inlined (e.g. PL/pgSQL) are also re-evaluated per row and cannot drive an index. Such policies turn millisecond queries into seconds on large tables.', run: true },
    good: { sql: `CREATE ROLE saas_app NOLOGIN;
GRANT SELECT ON users TO saas_app;
CREATE INDEX users_tenant_idx ON users (tenant_id);
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION current_tenant() RETURNS int LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::int $$;
CREATE POLICY fast_policy ON users USING (tenant_id = current_tenant());
SELECT set_config('app.tenant_id', '2', false);
SET ROLE saas_app;
SET enable_seqscan = off;
EXPLAIN (COSTS OFF) SELECT count(*) FROM users;
RESET ROLE;`, why: 'A STABLE helper is inlined and evaluated once; the simple equality on an indexed tenant_id becomes an index condition.', run: true }
  },
  mistakes: [
    'Choosing schema-per-tenant for a self-serve product that will reach tens of thousands of tenants.',
    'No index on tenant_id (or tenant_id not leading) in the shared model - every RLS query scans.',
    'Policies with per-row subqueries or VOLATILE functions.',
    'Marking user functions LEAKPROOF just to get index usage, although they can raise errors revealing values.',
    'Sharding on a column other than tenant_id, causing cross-shard joins for every request.',
    'Forgetting cross-tenant analytics needs a separate, audited BYPASSRLS role or a replica/warehouse.'
  ],
  best: [
    'Default to shared schema + tenant_id + RLS for SaaS; isolate exceptional tenants (size, compliance) in their own database or cluster.',
    'Make tenant_id the leading column of primary keys/indexes on large tables, e.g. PRIMARY KEY (tenant_id, id).',
    'Partition by tenant (LIST for whales, HASH for buckets) when tables grow large; shard on tenant_id (e.g. Citus) when one node is not enough.',
    'Keep policies to simple equality with STABLE helpers; prefer leakproof operators in hot predicates.',
    'Plan tenant lifecycle: onboarding, export, deletion (DELETE WHERE tenant_id or DETACH PARTITION), moving big tenants.'
  ],
  performance: `<p>Shared schema with indexed tenant_id adds near-zero RLS overhead. Partitioning by tenant reduces index depth and VACUUM scope and enables pruning; too many partitions (thousands) increase planning time - use HASH buckets for many small tenants. Schema-per-tenant performance per query is fine, but catalog growth slows planning, autovacuum scheduling, pg_dump and connection start-up (relcache warm-up). Database-per-tenant multiplies background processes per database (autovacuum) and complicates pooling (one pool per database).</p>`,
  security: `<p>Isolation strength ranks database &gt; schema &gt; RLS. With schemas, still revoke USAGE on other tenants' schemas from the app role if one role serves all tenants (or use one role per tenant); a wrong search_path otherwise silently reads another tenant. With RLS, the guarantees in the previous lessons apply (no owner/superuser/BYPASSRLS connections, SET LOCAL context). For regulated tenants, physical isolation may be a contractual requirement regardless of technical merit.</p>`,
  scenario: { title: 'Choosing a model for a new B2B SaaS: 50 tenants now, 20,000 expected, 3 enterprise prospects needing EU residency', steps: [
    '1. Majority: shared schema + tenant_id + RLS - scales to 20,000 tenants with one migration path.',
    '2. Put tenant_id first in PKs and indexes of every tenant table from day one (eases future partitioning/sharding).',
    '3. Enterprise EU tenants: a separate cluster in the EU region running the same schema (database-per-tenant/cluster for residency).',
    '4. Plan partitioning (HASH by tenant_id) for the largest tables once they exceed ~100 GB; plan Citus/app sharding only when a node saturates.',
    '5. Build tenant export/delete tooling and automated isolation tests before the first enterprise contract.'
  ] },
  widgets: ['diagram:multi-tenant', 'diagram:partitioning', 'diagram:sharding'],
  interview: [
    { q: 'Compare database-per-tenant, schema-per-tenant and shared schema.', a: 'Database-per-tenant gives the strongest isolation and easy per-tenant backup and residency but scales to few tenants and multiplies operations. Schema-per-tenant gives structural isolation in one database but suffers catalog bloat and N-times migrations beyond a few thousand tenants. Shared schema with tenant_id and RLS scales to very many tenants with one migration path and easy analytics, but isolation is logical and depends on correct RLS and connection roles.' },
    { q: 'What does LEAKPROOF mean and why does it matter for RLS performance?', a: 'A leakproof function reveals nothing about its arguments except through its return value - no errors or side effects that depend on the input. The planner may evaluate leakproof user predicates before RLS policy quals, allowing them to drive index scans; non-leakproof predicates must run after the policy. Only superusers can mark functions LEAKPROOF.' },
    { q: 'When would you partition or shard by tenant?', a: 'Partition by tenant (LIST for very large tenants, HASH for buckets) when tables get large enough that pruning, smaller indexes and per-partition maintenance matter, or when you want to detach and move tenants. Shard (application routing or Citus with tenant_id as distribution column) when one node cannot handle the total load or data size.' }
  ],
  exercises: [
    { task: 'Create a HASH-partitioned (4 buckets) table by tenant_id and show which partition each of tenants 1..6 lands in.',
      solution: `CREATE TABLE t_hash (tenant_id int NOT NULL, id int) PARTITION BY HASH (tenant_id);
CREATE TABLE t_hash_p0 PARTITION OF t_hash FOR VALUES WITH (MODULUS 4, REMAINDER 0);
CREATE TABLE t_hash_p1 PARTITION OF t_hash FOR VALUES WITH (MODULUS 4, REMAINDER 1);
CREATE TABLE t_hash_p2 PARTITION OF t_hash FOR VALUES WITH (MODULUS 4, REMAINDER 2);
CREATE TABLE t_hash_p3 PARTITION OF t_hash FOR VALUES WITH (MODULUS 4, REMAINDER 3);
INSERT INTO t_hash SELECT g, g FROM generate_series(1, 6) g;
SELECT tableoid::regclass AS partition, tenant_id FROM t_hash ORDER BY tenant_id;`, run: true },
    { task: 'Find which indexes on users have tenant_id as their leading column.',
      solution: `CREATE INDEX users_tenant_created ON users (tenant_id, created_at);
SELECT i.indexrelid::regclass AS index_name, pg_get_indexdef(i.indexrelid) AS definition
FROM pg_index i
JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
WHERE i.indrelid = 'users'::regclass AND a.attname = 'tenant_id';`, run: true }
  ],
  challenge: { task: 'Build a shared "tenant_orders" table with PRIMARY KEY (tenant_id, id), RLS via a STABLE helper, and an index on (tenant_id, created_at). Show with EXPLAIN that a "latest 5 orders" query for tenant 2 uses the composite index with the policy as index condition.',
    hint: 'ORDER BY created_at DESC LIMIT 5; SET enable_seqscan = off for the tiny demo.',
    solution: `CREATE TABLE tenant_orders (
  tenant_id  int NOT NULL,
  id         int NOT NULL,
  created_at timestamptz NOT NULL,
  amount     numeric(10,2) NOT NULL,
  PRIMARY KEY (tenant_id, id)
);
INSERT INTO tenant_orders
SELECT 1 + g % 3, g, timestamptz '2025-01-01' + g * interval '1 hour', (g % 500) + 10
FROM generate_series(1, 3000) g;
CREATE INDEX tenant_orders_recent ON tenant_orders (tenant_id, created_at);
ANALYZE tenant_orders;
CREATE FUNCTION current_tenant() RETURNS int LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::int $$;
CREATE ROLE orders_app NOLOGIN;
GRANT SELECT ON tenant_orders TO orders_app;
ALTER TABLE tenant_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY t ON tenant_orders USING (tenant_id = current_tenant());
SELECT set_config('app.tenant_id', '2', false);
SET ROLE orders_app;
SET enable_seqscan = off;
EXPLAIN (COSTS OFF) SELECT id, created_at, amount FROM tenant_orders ORDER BY created_at DESC LIMIT 5;
SELECT id, created_at, amount FROM tenant_orders ORDER BY created_at DESC LIMIT 5;
RESET ROLE;`, run: true },
  related: ['row-level-security-multi-tenant-saas', 'partitioning', 'sharding', 'distributed-postgresql'],
  quiz: [
    { type: 'design', q: 'Self-serve SaaS expecting 50,000 small tenants. Model?', options: ['Database per tenant', 'Schema per tenant', 'Shared schema + tenant_id + RLS', 'One cluster per tenant'], answer: 2, explain: 'Only the shared model scales operationally to tens of thousands of tenants.' },
    { type: 'mcq', q: 'Which predicate can be evaluated before an RLS policy and use an index?', options: ['lower(email) = $1', 'email LIKE $1', 'email = $1', 'my_plpgsql_func(email)'], answer: 2, explain: 'texteq is LEAKPROOF; lower(), LIKE and user functions are not.' },
    { type: 'tf', q: 'Citus is PostgreSQL\'s built-in declarative partitioning.', answer: false, explain: 'Citus is an extension / distributed database that shards tables across nodes; declarative partitioning is core.' },
    { type: 'index', q: 'Hot query under RLS: latest orders of the current tenant. Best index?', options: ['(created_at)', '(tenant_id, created_at)', '(created_at, tenant_id)', 'GIN on tenant_id'], answer: 1, explain: 'Equality on tenant_id (from the policy) then ordering by created_at.' },
    { type: 'scenario', q: 'Schema-per-tenant at 6,000 tenants: migrations take hours and memory per backend grows. Next step?', options: ['Add more schemas', 'Move to shared schema with tenant_id + RLS (partition if needed)', 'Disable autovacuum', 'Use BYPASSRLS'], answer: 1, explain: 'Catalog bloat is inherent to schema-per-tenant at that scale.' }
  ]
}
]);

})();
