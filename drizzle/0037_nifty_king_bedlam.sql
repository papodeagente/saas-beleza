ALTER TABLE "ai_agents" ADD COLUMN "mode" text DEFAULT 'personalizado' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_agents" ADD COLUMN "tone" text DEFAULT 'equilibrado' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_agents" ADD COLUMN "emoji_use" text DEFAULT 'poucos' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_agents" ADD COLUMN "goal" text;--> statement-breakpoint
ALTER TABLE "ai_agents" ADD COLUMN "handoff_when" jsonb;