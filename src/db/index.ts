import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// Vercel's Neon integration sets DATABASE_URL (and POSTGRES_URL). The pool
// only connects on first query, so a missing URL fails at request time.
const globalForDb = globalThis as unknown as { lukeosPool?: Pool };
const pool = (globalForDb.lukeosPool ??= createPool());

function createPool() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL ?? process.env.POSTGRES_URL,
    // Enough for a screen's lookups to run side by side rather than queue.
    max: 10,
  });
  // The free database drops idle connections when it goes to sleep. Log it
  // rather than letting it crash the server, which would mean another slow start.
  pool.on("error", (err) => console.error("[db] idle connection dropped:", err.message));
  return pool;
}

export const db = drizzle({ client: pool, schema });
export { schema };
