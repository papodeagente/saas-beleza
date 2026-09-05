import { desc, eq } from "drizzle-orm";
import { db, pool } from "../src/db";
import { appointments, customers } from "../src/db/schema";

async function main() {
  const created = await db
    .select({ id: customers.id, name: customers.name, phone: customers.phone })
    .from(customers)
    .where(eq(customers.source, "public_booking"))
    .orderBy(desc(customers.id))
    .limit(3);
  console.log("clientes do booking público:", created);

  const appts = await db
    .select({ id: appointments.id, source: appointments.source, createdBy: appointments.createdByUserId })
    .from(appointments)
    .where(eq(appointments.source, "public"))
    .orderBy(desc(appointments.id))
    .limit(3);
  console.log("atendimentos públicos:", appts);
}

main().finally(() => pool.end());
