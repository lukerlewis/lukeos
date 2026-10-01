ALTER TABLE "notes" ADD COLUMN "kind" text DEFAULT 'note' NOT NULL;--> statement-breakpoint
-- Requests Luke left on their own from the dashboard become @claude lines in
-- a new scratch pad, keeping their ids, so nothing he asked is lost.
INSERT INTO "notes" ("id", "title", "content", "kind")
SELECT gen_random_uuid(), 'Scratch pad',
  string_agg('[@claude](/claude/' || "id" || ') ' || replace("context", E'\n', ' '), E'\n\n' ORDER BY "created_at"),
  'scratchpad'
FROM "mentions" WHERE "target_type" = 'request'
HAVING count(*) > 0;--> statement-breakpoint
UPDATE "mentions"
SET "target_type" = 'note',
    "target_id" = (SELECT "id" FROM "notes" WHERE "kind" = 'scratchpad' LIMIT 1),
    "context" = '@claude ' || replace("context", E'\n', ' ')
WHERE "target_type" = 'request';
