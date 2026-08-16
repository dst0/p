# Database Engineering Patterns

Relational databases (like PostgreSQL) are the foundation of most modern applications. Proper schema design, indexing, and operational patterns are critical.

## Schema Design

- **Normalization:** Generally aim for 3rd Normal Form (3NF) to eliminate data redundancy.
- **Denormalization:** Accept controlled denormalization for read performance, but understand the write-side update anomaly trade-offs. Example: storing `comment_count` on a `Post` table to avoid `COUNT(*)` queries on hot paths.
- **Primary Keys:** Use UUIDs (specifically UUIDv7 for time-sorted locality) or BIGINT sequences. Avoid auto-incrementing integers for distributed or exposed IDs (to prevent insecure direct object reference or revealing business metrics).

## Indexing Strategies

- **B-tree:** Default index for equality (`=`) and range (`>`, `<`) queries.
- **Hash:** Only for equality. B-tree is usually preferred anyway.
- **GIN/GiST (Postgres):** For full-text search, arrays, and JSONB indexing.
- **Covering Indexes:** Include additional columns in the index to satisfy queries without accessing the heap table.
  ```sql
  CREATE INDEX idx_users_email ON users (email) INCLUDE (first_name, last_name);
  ```
- **Partial Indexes:** Index only a subset of data. Great for sparse columns or status flags.
  ```sql
  CREATE INDEX idx_active_users ON users (id) WHERE status = 'active';
  ```

## Query Optimization

- Always use `EXPLAIN ANALYZE` in PostgreSQL to view the actual execution plan, not just the estimate.
- Watch for `Seq Scan` (sequential scans) on large tables.
- **N+1 in ORMs:** The silent killer. Monitor ORM logs. Use eager loading (`.include()`, `.populate()`) strategically.

## Connection Pooling

Database connections are expensive.
- Use an external pooler like **pgBouncer** for PostgreSQL, especially in serverless environments (AWS Lambda) or with connection-heavy languages.
- Connection limits: Size pools based on `((core_count * 2) + effective_spindle_count)`. Too many connections leads to context-switching overhead.

## Zero-Downtime Migrations

Never lock tables for extended periods in production.
To rename a column or change its type, use the "Expand and Contract" pattern:
1. **Add new column.**
2. **Deploy code:** Write to both old and new columns, read from old.
3. **Backfill data:** Copy data from old to new column in chunks.
4. **Deploy code:** Read from new column.
5. **Drop old column.**

To add constraints safely in Postgres:
```sql
-- Adds constraint as NOT VALID (doesn't lock table for validation)
ALTER TABLE users ADD CONSTRAINT chk_age CHECK (age >= 18) NOT VALID;
-- Validates concurrently in background
ALTER TABLE users VALIDATE CONSTRAINT chk_age; 
```

## PostgreSQL Specifics

- **JSONB:** Excellent for schemaless data, configuration, or varying attributes.
  ```sql
  CREATE INDEX idx_user_metadata ON users USING GIN (metadata);
  SELECT * FROM users WHERE metadata @> '{"theme": "dark"}';
  ```
- **CTEs (Common Table Expressions):** Use `WITH` for readability in complex queries.
- **Window Functions:** Powerful for analytics (e.g., running totals, rankings).
  ```sql
  SELECT id, amount, SUM(amount) OVER (PARTITION BY user_id ORDER BY created_at) as running_total FROM orders;
  ```
- **Advisory Locks:** Use Postgres to coordinate application-level distributed locks.

## Redis Patterns

- **Caching:** Cache expensive queries or API responses. Always set a TTL.
- **Pub/Sub:** Fast message broadcasting (fire-and-forget).
- **Sorted Sets (ZSET):** Leaderboards, time-series data, rate limiting sliding windows.
- **Lua Scripting:** Execute multiple Redis commands atomically.
