// Postgres store for the game API.
//
// api.js only needs get/all/run/batch, and writes plain SQLite-flavoured SQL with
// `?` placeholders. This adapts that to node-postgres ($n placeholders, rowCount)
// so the same game server can run against Neon/Render Postgres instead of a
// local SQLite file. That matters on Render's free plan, which has no disk.
export function pgStore(pool) {
  const conv = (sql) => {
    let i = 0;
    return sql.replace(/\?/g, () => '$' + (++i));
  };
  return {
    get: async (sql, params = []) => (await pool.query(conv(sql), params)).rows[0],
    all: async (sql, params = []) => (await pool.query(conv(sql), params)).rows,
    run: async (sql, params = []) => ({ changes: (await pool.query(conv(sql), params)).rowCount }),
    batch: async (statements) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = [];
        for (const s of statements) out.push(await client.query(conv(s.sql), s.params || []));
        await client.query('COMMIT');
        return out;
      } catch (err) {
        try { await client.query('ROLLBACK'); } catch {}
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

// Same tables as server/schema.sql, but bigint for anything holding Date.now()
// (int4 tops out at 2.1e9, and epoch millis are ~1.7e12).
export const PG_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, username TEXT NOT NULL UNIQUE, password TEXT NOT NULL, salt TEXT NOT NULL, created BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS saves (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, data TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, updated BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, started BIGINT NOT NULL);
`;
