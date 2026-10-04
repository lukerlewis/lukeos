ALTER TABLE "cards" ADD COLUMN "rejected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "reject_reason" text;