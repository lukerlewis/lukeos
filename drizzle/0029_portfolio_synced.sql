ALTER TABLE "archive_entries" ADD COLUMN "portfolio_synced_at" timestamp with time zone;--> statement-breakpoint
-- Notes already written count as up to date with today's stories.
UPDATE "archive_entries" SET "portfolio_synced_at" = now() WHERE "portfolio_facts" <> '';
