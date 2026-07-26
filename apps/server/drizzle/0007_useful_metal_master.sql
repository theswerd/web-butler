CREATE TABLE "browser_action" (
	"id" text PRIMARY KEY NOT NULL,
	"turn_id" text NOT NULL,
	"user_id" text NOT NULL,
	"request" jsonb NOT NULL,
	"result" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" bigint NOT NULL,
	"resolved_at" bigint
);
--> statement-breakpoint
CREATE TABLE "turn" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"task_id" text,
	"vm_id" text NOT NULL,
	"provider" text NOT NULL,
	"kind" text DEFAULT 'task' NOT NULL,
	"status" text NOT NULL,
	"message" text NOT NULL,
	"preamble" text,
	"outcome_path" text NOT NULL,
	"context_manifest" jsonb,
	"agent_command" text,
	"cancel_requested" boolean DEFAULT false NOT NULL,
	"cache_key" text,
	"retries" integer DEFAULT 0 NOT NULL,
	"retry_kind" text,
	"pending_outcomes" jsonb,
	"reply" text,
	"stop_reason" text,
	"outcomes" jsonb,
	"suggestions" jsonb,
	"highlights" jsonb,
	"error" text,
	"created_at" bigint NOT NULL,
	"started_at" bigint,
	"finished_at" bigint,
	"heartbeat_at" bigint,
	"wake_at" bigint
);
--> statement-breakpoint
CREATE TABLE "turn_update" (
	"turn_id" text NOT NULL,
	"seq" integer NOT NULL,
	"updates" jsonb NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "turn_update_turn_id_seq_pk" PRIMARY KEY("turn_id","seq")
);
--> statement-breakpoint
ALTER TABLE "sandbox" ADD COLUMN "daemon_token" text;--> statement-breakpoint
ALTER TABLE "turn" ADD CONSTRAINT "turn_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "browser_action_turn_idx" ON "browser_action" USING btree ("turn_id","status");--> statement-breakpoint
CREATE INDEX "turn_vm_status_idx" ON "turn" USING btree ("vm_id","status");--> statement-breakpoint
CREATE INDEX "turn_user_created_idx" ON "turn" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "turn_cache_key_idx" ON "turn" USING btree ("cache_key");--> statement-breakpoint
CREATE INDEX "sandbox_daemon_token_idx" ON "sandbox" USING btree ("daemon_token");