import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

declare global {
  // eslint-disable-next-line no-var
  var __dbPool: Pool | undefined;
}

// Em dev o Next recarrega módulos; o pool precisa sobreviver ao hot reload.
const pool =
  global.__dbPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
  });
if (process.env.NODE_ENV !== "production") global.__dbPool = pool;

export const db = drizzle(pool, { schema });
export { pool, schema };
