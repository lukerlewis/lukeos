CREATE TABLE "mentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"context" text NOT NULL,
	"anchored" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"reply" text,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "mentions_target_idx" ON "mentions" USING btree ("target_type","target_id");