CREATE TYPE "public"."ai_action_result" AS ENUM('ok', 'error', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."ai_agent_status" AS ENUM('off', 'testing', 'active');--> statement-breakpoint
CREATE TYPE "public"."wa_connection_status" AS ENUM('disconnected', 'connecting', 'connected', 'error');--> statement-breakpoint
CREATE TYPE "public"."wa_message_status" AS ENUM('pending', 'sent', 'delivered', 'read', 'failed');--> statement-breakpoint
CREATE TYPE "public"."wa_message_type" AS ENUM('text', 'image', 'audio', 'video', 'document', 'sticker', 'location', 'contact', 'system', 'unsupported');--> statement-breakpoint
CREATE TABLE "ai_agent_customer_memos" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"organization_id" bigint NOT NULL,
	"customer_id" bigint NOT NULL,
	"content" text NOT NULL,
	"facts" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_agent_knowledge" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"organization_id" bigint NOT NULL,
	"agent_id" bigint,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"tags" jsonb,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_agent_permissions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"agent_id" bigint NOT NULL,
	"organization_id" bigint NOT NULL,
	"read_customer" boolean DEFAULT true NOT NULL,
	"read_appointments" boolean DEFAULT true NOT NULL,
	"read_services" boolean DEFAULT true NOT NULL,
	"read_availability" boolean DEFAULT true NOT NULL,
	"read_knowledge" boolean DEFAULT true NOT NULL,
	"create_appointment" boolean DEFAULT false NOT NULL,
	"reschedule_appointment" boolean DEFAULT false NOT NULL,
	"cancel_appointment" boolean DEFAULT false NOT NULL,
	"update_customer" boolean DEFAULT false NOT NULL,
	"add_note" boolean DEFAULT true NOT NULL,
	"transfer_to_human" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_usage_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"organization_id" bigint NOT NULL,
	"agent_id" bigint,
	"conversation_id" bigint,
	"feature" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_micros" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_connections" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"organization_id" bigint NOT NULL,
	"name" text DEFAULT 'WhatsApp' NOT NULL,
	"base_url" text NOT NULL,
	"instance_token" text NOT NULL,
	"instance_id" text,
	"instance_name" text,
	"phone_number" text,
	"profile_name" text,
	"status" "wa_connection_status" DEFAULT 'disconnected' NOT NULL,
	"status_detail" text,
	"webhook_token" text NOT NULL,
	"webhook_seen_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"connected_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_webhook_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"connection_id" bigint NOT NULL,
	"organization_id" bigint NOT NULL,
	"event_type" text NOT NULL,
	"dedupe_key" text,
	"payload" jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "body" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "ai_agents" ADD COLUMN "connection_id" bigint;--> statement-breakpoint
ALTER TABLE "ai_agents" ADD COLUMN "status" "ai_agent_status" DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_agents" ADD COLUMN "model" text DEFAULT 'gpt-5-chat-latest' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_agents" ADD COLUMN "temperature" integer DEFAULT 70 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_agents" ADD COLUMN "max_output_tokens" integer DEFAULT 600 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_agents" ADD COLUMN "debounce_window_seconds" integer DEFAULT 8 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_agents" ADD COLUMN "response_delay_seconds" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_agents" ADD COLUMN "pause_on_human_reply" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_agents" ADD COLUMN "respond_groups" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_agents" ADD COLUMN "business_hours_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_agents" ADD COLUMN "out_of_hours_message" text;--> statement-breakpoint
ALTER TABLE "ai_agents" ADD COLUMN "handoff_message" text;--> statement-breakpoint
ALTER TABLE "ai_agents" ADD COLUMN "max_turns_per_minute_per_org" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_agents" ADD COLUMN "max_turns_per_minute_per_contact" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_agents" ADD COLUMN "max_concurrent_turns" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_agents" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_execution_logs" ADD COLUMN "result" "ai_action_result" DEFAULT 'ok' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_execution_logs" ADD COLUMN "duration_ms" integer;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "connection_id" bigint;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "remote_jid" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "is_group" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "contact_name" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "profile_pic_url" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "assigned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "last_assigned_user_id" bigint;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "resolved_by_user_id" bigint;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "ai_paused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "ai_paused_by_user_id" bigint;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "ai_last_processed_inbound_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "unread_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "last_inbound_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "last_outbound_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "sender_user_id" bigint;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "message_type" "wa_message_type" DEFAULT 'text' NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "status" "wa_message_status" DEFAULT 'sent' NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "quoted_external_id" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "media_url" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "media_mime_type" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "media_file_name" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "media_size_bytes" bigint;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "audio_transcription" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "error_message" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "raw" jsonb;--> statement-breakpoint
ALTER TABLE "ai_agent_customer_memos" ADD CONSTRAINT "ai_agent_customer_memos_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_customer_memos" ADD CONSTRAINT "ai_agent_customer_memos_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_knowledge" ADD CONSTRAINT "ai_agent_knowledge_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_knowledge" ADD CONSTRAINT "ai_agent_knowledge_agent_id_ai_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_permissions" ADD CONSTRAINT "ai_agent_permissions_agent_id_ai_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_permissions" ADD CONSTRAINT "ai_agent_permissions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_agent_id_ai_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_connections" ADD CONSTRAINT "whatsapp_connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_webhook_events" ADD CONSTRAINT "whatsapp_webhook_events_connection_id_whatsapp_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."whatsapp_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_webhook_events" ADD CONSTRAINT "whatsapp_webhook_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_agent_memos_customer_unique" ON "ai_agent_customer_memos" USING btree ("organization_id","customer_id");--> statement-breakpoint
CREATE INDEX "ai_agent_knowledge_org_idx" ON "ai_agent_knowledge" USING btree ("organization_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_agent_permissions_agent_unique" ON "ai_agent_permissions" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "ai_usage_org_idx" ON "ai_usage_logs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "wa_connections_org_idx" ON "whatsapp_connections" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wa_connections_webhook_token_unique" ON "whatsapp_connections" USING btree ("webhook_token");--> statement-breakpoint
CREATE INDEX "wa_webhook_events_conn_idx" ON "whatsapp_webhook_events" USING btree ("connection_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "wa_webhook_events_dedupe_unique" ON "whatsapp_webhook_events" USING btree ("connection_id","dedupe_key") WHERE dedupe_key is not null;--> statement-breakpoint
ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_connection_id_whatsapp_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."whatsapp_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_connection_id_whatsapp_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."whatsapp_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_last_assigned_user_id_users_id_fk" FOREIGN KEY ("last_assigned_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_ai_paused_by_user_id_users_id_fk" FOREIGN KEY ("ai_paused_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversations_org_assigned_idx" ON "conversations" USING btree ("organization_id","assigned_user_id","last_message_at");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_org_jid_unique" ON "conversations" USING btree ("organization_id","remote_jid") WHERE remote_jid is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "messages_org_external_unique" ON "messages" USING btree ("organization_id","external_id") WHERE external_id is not null;