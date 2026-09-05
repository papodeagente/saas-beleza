import { eq, ne } from "drizzle-orm";
import { db, pool } from "../src/db";
import * as s from "../src/db/schema";

/**
 * Define quem administra a plataforma.
 *
 * O painel exige estar logado como administrador para promover alguém, o que
 * cria um problema de origem: a primeira concessão não tem quem a conceda. Este
 * script é essa porta, e ela fica fora do produto de propósito — quem tem acesso
 * ao servidor já teria acesso ao banco de qualquer forma.
 *
 * É idempotente: rodar de novo não duplica nem derruba nada.
 *
 * Uso:
 *   pnpm exec tsx --env-file=.env.local scripts/definir-super-admin.ts email@dominio
 *   pnpm exec tsx --env-file=.env.local scripts/definir-super-admin.ts email@dominio --exclusivo
 *
 * `--exclusivo` remove os demais acessos de plataforma, que é o que se quer ao
 * trocar um administrador de demonstração pelo dono real do produto.
 */

async function main() {
  const email = (process.argv[2] ?? "").trim().toLowerCase();
  const exclusivo = process.argv.includes("--exclusivo");

  if (!email.includes("@")) {
    console.error("Informe o e-mail. Exemplo: scripts/definir-super-admin.ts bruno@entur.com.br --exclusivo");
    process.exit(1);
  }

  const [user] = await db.select().from(s.users).where(eq(s.users.email, email)).limit(1);
  if (!user) {
    // Promover não cria conta: a pessoa precisa existir e ter senha própria.
    console.error(`Nenhum usuário com o e-mail ${email}. Crie a conta no sistema antes de promover.`);
    process.exit(1);
  }

  await db.insert(s.platformAdmins).values({ userId: user.id }).onConflictDoNothing();
  console.log(`${user.name} <${user.email}> administra a plataforma.`);

  if (exclusivo) {
    const removidos = await db
      .delete(s.platformAdmins)
      .where(ne(s.platformAdmins.userId, user.id))
      .returning({ userId: s.platformAdmins.userId });

    if (removidos.length > 0) {
      const nomes = await db.select({ id: s.users.id, name: s.users.name, email: s.users.email }).from(s.users);
      const porId = new Map(nomes.map((n) => [n.id, n]));
      for (const r of removidos) {
        const quem = porId.get(r.userId);
        console.log(`  acesso removido: ${quem?.name ?? "usuário"} <${quem?.email ?? r.userId}>`);
      }
    }
  }

  const finais = await db
    .select({ name: s.users.name, email: s.users.email })
    .from(s.platformAdmins)
    .innerJoin(s.users, eq(s.users.id, s.platformAdmins.userId));
  console.log("\nAdministradores da plataforma agora:");
  for (const a of finais) console.log(`  ${a.name} <${a.email}>`);

  await pool.end();
}

main().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});
