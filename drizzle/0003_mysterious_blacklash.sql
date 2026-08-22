DROP INDEX "conversations_org_jid_unique";--> statement-breakpoint
DROP INDEX "messages_org_external_unique";--> statement-breakpoint
DROP INDEX "wa_webhook_events_dedupe_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_org_jid_unique" ON "conversations" USING btree ("organization_id","remote_jid");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_org_external_unique" ON "messages" USING btree ("organization_id","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wa_webhook_events_dedupe_unique" ON "whatsapp_webhook_events" USING btree ("connection_id","dedupe_key");