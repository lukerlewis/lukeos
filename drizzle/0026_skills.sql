-- SOPs are now called skills. The tables keep their old names; this only
-- updates what the activity log shows for past changes.
UPDATE "activity_log" SET "item_type" = 'skill' WHERE "item_type" = 'sop';--> statement-breakpoint
UPDATE "activity_log" SET "summary" = regexp_replace("summary", '\mSOP\M', 'skill', 'g') WHERE "summary" ~ '\mSOP\M';
