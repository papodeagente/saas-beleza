import { asc, desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { aiAgentKnowledge, aiAgentPermissions, aiAgents } from "@/db/schema";
import { AGENT_MODELS, DEFAULT_MODEL, hasApiKeyFor } from "@/server/ai/llm";
import { requireSession } from "@/server/auth";
import { getConnection } from "@/server/services/whatsapp-connection-service";
import { AgentView } from "./agente-view";

export const metadata = { title: "Agente de IA" };
export const dynamic = "force-dynamic";

export default async function AgentePage() {
  const ctx = await requireSession();
  if (ctx.role !== "owner" && ctx.role !== "admin") redirect("/hoje");

  const [agent] = await db
    .select()
    .from(aiAgents)
    .where(eq(aiAgents.organizationId, ctx.organizationId))
    .orderBy(asc(aiAgents.id))
    .limit(1);

  const [permissions] = agent
    ? await db.select().from(aiAgentPermissions).where(eq(aiAgentPermissions.agentId, agent.id)).limit(1)
    : [];

  const knowledge = await db
    .select({
      id: aiAgentKnowledge.id,
      title: aiAgentKnowledge.title,
      content: aiAgentKnowledge.content,
    })
    .from(aiAgentKnowledge)
    .where(eq(aiAgentKnowledge.organizationId, ctx.organizationId))
    .orderBy(desc(aiAgentKnowledge.updatedAt))
    .limit(50);

  const connection = await getConnection(ctx);
  const model = agent?.model ?? DEFAULT_MODEL;

  return (
    <AgentView
      organizationName={ctx.organizationName}
      models={AGENT_MODELS}
      apiKeyPresent={hasApiKeyFor(model)}
      whatsappConnected={connection?.status === "connected"}
      knowledge={knowledge}
      config={{
        name: agent?.name ?? "Assistente",
        status: agent?.status ?? "off",
        enabled: agent?.enabled ?? false,
        instructions: agent?.instructions ?? "",
        model,
        temperature: agent?.temperature ?? 70,
        maxOutputTokens: agent?.maxOutputTokens ?? 600,
        debounceWindowSeconds: agent?.debounceWindowSeconds ?? 8,
        responseDelaySeconds: agent?.responseDelaySeconds ?? 0,
        pauseOnHumanReply: agent?.pauseOnHumanReply ?? true,
        respondGroups: agent?.respondGroups ?? false,
        businessHoursOnly: agent?.businessHoursOnly ?? false,
        outOfHoursMessage: agent?.outOfHoursMessage ?? null,
        maxTurnsPerMinutePerOrg: agent?.maxTurnsPerMinutePerOrg ?? 30,
        maxTurnsPerMinutePerContact: agent?.maxTurnsPerMinutePerContact ?? 3,
        extendedThinking: (agent?.config as { extendedThinking?: boolean } | null)?.extendedThinking ?? false,
      }}
      permissions={{
        readCustomer: permissions?.readCustomer ?? true,
        readAppointments: permissions?.readAppointments ?? true,
        readServices: permissions?.readServices ?? true,
        readAvailability: permissions?.readAvailability ?? true,
        readKnowledge: permissions?.readKnowledge ?? true,
        createAppointment: permissions?.createAppointment ?? false,
        rescheduleAppointment: permissions?.rescheduleAppointment ?? false,
        cancelAppointment: permissions?.cancelAppointment ?? false,
        updateCustomer: permissions?.updateCustomer ?? false,
        addNote: permissions?.addNote ?? true,
        transferToHuman: permissions?.transferToHuman ?? true,
      }}
    />
  );
}
