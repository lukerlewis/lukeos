CREATE TABLE "activity_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"agent_name" text NOT NULL,
	"routine" text,
	"tool" text NOT NULL,
	"summary" text NOT NULL,
	"item_type" text,
	"item_id" uuid
);
--> statement-breakpoint
CREATE INDEX "activity_log_at_idx" ON "activity_log" USING btree ("at");