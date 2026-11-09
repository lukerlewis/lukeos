-- Aya is gone as an area (Luke, 2026-11-09): anything still in it, including projects and tasks in Trash, moves to Work.
UPDATE "projects" SET "area" = 'work' WHERE "area" = 'aya';--> statement-breakpoint
UPDATE "tasks" SET "area" = 'work' WHERE "area" = 'aya';
