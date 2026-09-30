import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// Vercel's Neon integration sets DATABASE_URL (and POSTGRES_URL). The pool
// only connects on first query, so a missing URL fails at request time.
const globalForDb = globalThis as unknown as { lukeosPool?: Pool };
const pool = (globalForDb.lukeosPool ??= new Pool({
  connectionString: process.env.DATABASE_URL ?? process.env.POSTGRES_URL,
  max: 3,
}));

export const db = drizzle({ client: pool, schema });
export { schema };
