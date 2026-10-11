CREATE TABLE "visitor_prompts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text DEFAULT 'ask' NOT NULL,
	"question" text NOT NULL,
	"reply" text DEFAULT '' NOT NULL,
	"tab" text,
	"settings" text,
	"visit" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "archive_entries" ADD COLUMN "on_portfolio" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "archive_entries" ADD COLUMN "portfolio_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "archive_entries" ADD COLUMN "portfolio_title" text;--> statement-breakpoint
ALTER TABLE "archive_entries" ADD COLUMN "portfolio_short" text;--> statement-breakpoint
ALTER TABLE "archive_entries" ADD COLUMN "portfolio_summary" text;--> statement-breakpoint
ALTER TABLE "archive_entries" ADD COLUMN "portfolio_kind" text;--> statement-breakpoint
ALTER TABLE "archive_entries" ADD COLUMN "portfolio_year" text;--> statement-breakpoint
ALTER TABLE "archive_entries" ADD COLUMN "portfolio_facts" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX "visitor_prompts_created_idx" ON "visitor_prompts" USING btree ("created_at");