ALTER TABLE "tasks" ADD COLUMN "bucket" text DEFAULT 'today' NOT NULL;--> statement-breakpoint
-- Once only: put each existing task in the list its due date pointed to, as seen in Luke's time zone.
WITH d AS (
  SELECT (now() AT TIME ZONE coalesce((SELECT "value" FROM "app_settings" WHERE "key" = 'timezone'), 'UTC'))::date AS today
), w AS (
  SELECT today, today + 1 AS tomorrow,
    CASE WHEN today + (7 - extract(isodow FROM today)::int) > today + 1
      THEN today + (7 - extract(isodow FROM today)::int)
      ELSE (today + 2) + (7 - extract(isodow FROM today + 2)::int) END AS week_end
  FROM d
)
UPDATE "tasks" SET "bucket" = CASE
  WHEN "due_date" IS NULL THEN 'later'
  WHEN "due_date" <= w.today THEN 'today'
  WHEN "due_date" = w.tomorrow THEN 'tomorrow'
  WHEN "due_date" <= w.week_end THEN 'this_week'
  ELSE 'later' END
FROM w;
