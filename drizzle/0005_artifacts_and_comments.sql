CREATE TABLE "artifact_parts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"format" text DEFAULT 'markdown' NOT NULL,
	"content" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifact_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artifact_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"note" text,
	"created_by_kind" text DEFAULT 'agent' NOT NULL,
	"created_by_name" text,
	"created_by_routine" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifact_versions_number_unique" UNIQUE("artifact_id","number")
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"title" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_kind" text DEFAULT 'user' NOT NULL,
	"created_by_name" text,
	"created_by_routine" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"parent_id" uuid,
	"version" integer,
	"quote" text,
	"body" text NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_by_kind" text DEFAULT 'user' NOT NULL,
	"created_by_name" text,
	"created_by_routine" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "artifact_parts" ADD CONSTRAINT "artifact_parts_version_id_artifact_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."artifact_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_versions" ADD CONSTRAINT "artifact_versions_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_parent_id_comments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artifact_parts_version_idx" ON "artifact_parts" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "artifacts_project_idx" ON "artifacts" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "artifacts_updated_idx" ON "artifacts" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "comments_target_idx" ON "comments" USING btree ("target_type","target_id");--> statement-breakpoint
-- Notes Claude made become artifacts (same id, one version, one part), so
-- Luke's Notes are only his own from now on.
INSERT INTO "artifacts" ("id", "project_id", "title", "version", "created_by_kind", "created_by_name", "created_by_routine", "created_at", "updated_at", "deleted_at")
SELECT "id", "project_id", "title", 1, "created_by_kind", "created_by_name", "created_by_routine", "created_at", "updated_at", "deleted_at"
FROM "notes" WHERE "created_by_kind" = 'agent';--> statement-breakpoint
INSERT INTO "artifact_versions" ("id", "artifact_id", "number", "created_by_kind", "created_by_name", "created_by_routine", "created_at")
SELECT gen_random_uuid(), "id", 1, "created_by_kind", "created_by_name", "created_by_routine", "created_at"
FROM "notes" WHERE "created_by_kind" = 'agent';--> statement-breakpoint
INSERT INTO "artifact_parts" ("version_id", "position", "name", "format", "content")
SELECT v."id", 0, '', n."format", n."content"
FROM "notes" n JOIN "artifact_versions" v ON v."artifact_id" = n."id"
WHERE n."created_by_kind" = 'agent';--> statement-breakpoint
UPDATE "activity_log" SET "item_type" = 'artifact'
WHERE "item_type" = 'note' AND "item_id" IN (SELECT "id" FROM "artifacts");--> statement-breakpoint
DELETE FROM "notes" WHERE "created_by_kind" = 'agent';
