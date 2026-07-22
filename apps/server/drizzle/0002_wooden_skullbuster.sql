CREATE TABLE "task" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"scope" text NOT NULL,
	"prompt" text NOT NULL,
	"url" text NOT NULL,
	"status" text NOT NULL,
	"started_at" bigint NOT NULL,
	"finished_at" bigint,
	"outcome" text,
	"report_id" text,
	"seen" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_user_started_idx" ON "task" USING btree ("user_id","started_at");