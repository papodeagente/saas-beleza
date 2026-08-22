/**
 * Aplica as migrations antes do servidor subir.
 *
 * Roda no start do contêiner: o deploy só serve tráfego depois que o schema
 * está no lugar. Sem DATABASE_URL o processo falha de propósito — subir a
 * aplicação sem banco só adiaria o erro para o primeiro request.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL não definida — o contêiner não pode subir sem banco.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url, max: 1 });

try {
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  console.log("Migrations aplicadas.");
} catch (error) {
  console.error("Falha ao aplicar migrations:", error);
  process.exit(1);
} finally {
  await pool.end();
}
