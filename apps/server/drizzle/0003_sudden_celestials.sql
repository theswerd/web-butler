CREATE TABLE "extension" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"url_patterns" jsonb NOT NULL,
	"script" text NOT NULL,
	"stage" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"task_id" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "extension_id" text;--> statement-breakpoint
ALTER TABLE "extension" ADD CONSTRAINT "extension_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "extension_user_idx" ON "extension" USING btree ("user_id");