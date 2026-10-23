-- Aya becomes its own area (Luke, 2026-10-23): the old "Aya" project is renamed Admin and moves there with its tasks.
UPDATE "projects" SET "name" = 'Admin', "area" = 'aya' WHERE "id" = '825aab17-6874-497f-a52d-71416a3fa233';--> statement-breakpoint
UPDATE "tasks" SET "area" = 'aya' WHERE "project_id" = '825aab17-6874-497f-a52d-71416a3fa233';
