import { redirect } from "next/navigation";
import { requireSession } from "@/server/auth";
import { getSupervisionSnapshot } from "@/server/services/supervision-service";
import { SupervisaoView } from "./supervisao-view";

export const metadata = { title: "Supervisão" };
export const dynamic = "force-dynamic";

export default async function SupervisaoPage() {
  const ctx = await requireSession();
  if (ctx.role !== "owner" && ctx.role !== "admin") redirect("/inbox");

  const snapshot = await getSupervisionSnapshot(ctx);

  return (
    <SupervisaoView
      initial={{
        ...snapshot,
        agents: snapshot.agents.map((a) => ({
          ...a,
          lastActivityAt: a.lastActivityAt?.toISOString() ?? null,
        })),
        queue: snapshot.queue.map((q) => ({
          ...q,
          waitingSince: q.waitingSince?.toISOString() ?? null,
        })),
      }}
    />
  );
}
