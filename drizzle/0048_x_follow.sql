ALTER TABLE "x_people" ADD COLUMN "following" boolean;--> statement-breakpoint
ALTER TABLE "x_people" ADD COLUMN "follow_want" boolean;--> statement-breakpoint
ALTER TABLE "x_people" ADD COLUMN "follow_error" text;