CREATE TABLE "whiteboards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_kind" text DEFAULT 'user' NOT NULL,
	"created_by_name" text,
	"created_by_routine" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "whiteboards_updated_idx" ON "whiteboards" USING btree ("updated_at");