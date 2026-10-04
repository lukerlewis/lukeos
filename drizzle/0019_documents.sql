CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"title" text DEFAULT '' NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"claude_changed_at" timestamp with time zone,
	"created_by_kind" text DEFAULT 'user' NOT NULL,
	"created_by_name" text,
	"created_by_routine" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "routine_runs" ADD COLUMN "document_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_project_idx" ON "documents" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "documents_updated_idx" ON "documents" USING btree ("updated_at");--> statement-breakpoint
-- Documents replace artifacts as what Claude makes. Copy every artifact that's
-- plain writing (Markdown) into Documents, keeping its id, so its comments,
-- texts and routine runs can follow it there. The artifacts themselves stay
-- as they were, hidden with the Artifacts tab.
INSERT INTO "documents" ("id", "project_id", "title", "content", "created_by_kind", "created_by_name", "created_by_routine", "created_at", "updated_at")
SELECT a."id", a."project_id", a."title",
  (SELECT string_agg(
     CASE WHEN (SELECT count(*) FROM "artifact_parts" q WHERE q."version_id" = v."id") > 1 AND p."name" <> ''
       THEN '## ' || p."name" || E'\n\n' || btrim(p."content")
       ELSE btrim(p."content") END,
     E'\n\n' ORDER BY p."position")
   FROM "artifact_parts" p WHERE p."version_id" = v."id"),
  a."created_by_kind", a."created_by_name", a."created_by_routine", a."created_at", a."updated_at"
FROM "artifacts" a
JOIN "artifact_versions" v ON v."artifact_id" = a."id" AND v."number" = a."version"
WHERE a."deleted_at" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "artifact_parts" p WHERE p."version_id" = v."id" AND p."format" <> 'markdown')
  AND EXISTS (SELECT 1 FROM "artifact_parts" p WHERE p."version_id" = v."id");
--> statement-breakpoint
UPDATE "comments" SET "target_type" = 'document', "version" = NULL
WHERE "target_type" = 'artifact' AND "target_id" IN (SELECT "id" FROM "documents");
--> statement-breakpoint
UPDATE "messages" SET "link_type" = 'document'
WHERE "link_type" = 'artifact' AND "link_id" IN (SELECT "id" FROM "documents");
--> statement-breakpoint
UPDATE "routine_runs" SET "document_id" = "artifact_id", "artifact_id" = NULL
WHERE "artifact_id" IN (SELECT "id" FROM "documents");
--> statement-breakpoint
UPDATE "activity_log" SET "item_type" = 'document'
WHERE "item_type" = 'artifact' AND "item_id" IN (SELECT "id" FROM "documents");
