ALTER TABLE "projects" ALTER COLUMN "area" SET DEFAULT 'work';--> statement-breakpoint
UPDATE "projects" SET "area" = 'work';--> statement-breakpoint
UPDATE "tasks" SET "area" = 'work' WHERE "project_id" IS NOT NULL;
