-- 0026 ran on the first preview build, while the live site was still
-- logging "SOP" lines. This catches the ones written in between.
UPDATE "activity_log" SET "item_type" = 'skill' WHERE "item_type" = 'sop';--> statement-breakpoint
UPDATE "activity_log" SET "summary" = regexp_replace("summary", '\mSOP\M', 'skill', 'g') WHERE "summary" ~ '\mSOP\M';
