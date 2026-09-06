"use server";

import { requireSession } from "@/server/auth";
import { markWelcomeVideoSeen } from "@/server/services/welcome-video";

export async function markWelcomeVideoSeenAction(): Promise<void> {
  const ctx = await requireSession();
  await markWelcomeVideoSeen(ctx.organizationId);
}
