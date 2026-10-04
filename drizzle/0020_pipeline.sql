CREATE TABLE "card_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_id" uuid NOT NULL,
	"item_type" text NOT NULL,
	"item_id" uuid NOT NULL,
	"created_by_kind" text DEFAULT 'user' NOT NULL,
	"created_by_name" text,
	"created_by_routine" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_attachments_once" UNIQUE("card_id","item_type","item_id")
);
--> statement-breakpoint
CREATE TABLE "cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"column_id" uuid,
	"title" text NOT NULL,
	"notes" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_by_kind" text DEFAULT 'user' NOT NULL,
	"created_by_name" text,
	"created_by_routine" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pipeline_columns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "card_id" uuid;--> statement-breakpoint
ALTER TABLE "card_attachments" ADD CONSTRAINT "card_attachments_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_column_id_pipeline_columns_id_fk" FOREIGN KEY ("column_id") REFERENCES "public"."pipeline_columns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_columns" ADD CONSTRAINT "pipeline_columns_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "card_attachments_item_idx" ON "card_attachments" USING btree ("item_type","item_id");--> statement-breakpoint
CREATE INDEX "cards_project_idx" ON "cards" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "cards_column_idx" ON "cards" USING btree ("column_id");--> statement-breakpoint
CREATE INDEX "pipeline_columns_project_idx" ON "pipeline_columns" USING btree ("project_id");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_card_idx" ON "tasks" USING btree ("card_id");--> statement-breakpoint
-- Luke's Content project, with its pipeline: made if there's no live project
-- called Content, and given the columns if it has none yet.
INSERT INTO "projects" ("name", "color", "created_by_kind", "created_by_name")
SELECT 'Content',
  coalesce(
    (SELECT c FROM unnest(ARRAY['pink','violet','teal','green','amber','blue','orange','slate']) WITH ORDINALITY AS u(c, n)
     WHERE c NOT IN (SELECT "color" FROM "projects" WHERE "deleted_at" IS NULL) ORDER BY n LIMIT 1),
    'pink'),
  'agent', 'Claude'
WHERE NOT EXISTS (SELECT 1 FROM "projects" WHERE lower("name") = 'content' AND "deleted_at" IS NULL);
--> statement-breakpoint
INSERT INTO "pipeline_columns" ("project_id", "name", "position")
SELECT p."id", c."name", c."position"
FROM (SELECT "id" FROM "projects" WHERE lower("name") = 'content' AND "deleted_at" IS NULL ORDER BY "created_at" LIMIT 1) p
CROSS JOIN (VALUES ('Ideas', 0), ('Drafting', 1), ('Review', 2), ('Scheduled', 3), ('Published', 4)) AS c("name", "position")
WHERE NOT EXISTS (SELECT 1 FROM "pipeline_columns" x WHERE x."project_id" = p."id");
