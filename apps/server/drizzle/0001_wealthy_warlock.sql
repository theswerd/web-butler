CREATE TABLE "sandbox" (
	"user_id" text PRIMARY KEY NOT NULL,
	"vm_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "is_anonymous" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "sandbox" ADD CONSTRAINT "sandbox_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;