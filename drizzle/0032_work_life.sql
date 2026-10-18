ALTER TABLE "projects" ADD COLUMN "area" text DEFAULT 'life' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "area" text DEFAULT 'life' NOT NULL;--> statement-breakpoint
UPDATE "tasks" SET "effort" = CASE "effort" WHEN 'small' THEN 'shallow' WHEN 'medium' THEN 'focus' WHEN 'large' THEN 'deep' ELSE "effort" END WHERE "effort" IS NOT NULL;
