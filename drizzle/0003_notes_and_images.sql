CREATE TABLE "images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mime_type" text NOT NULL,
	"bytes" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"created_by_kind" text DEFAULT 'user' NOT NULL,
	"created_by_name" text,
	"created_by_routine" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"title" text DEFAULT '' NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"format" text DEFAULT 'markdown' NOT NULL,
	"created_by_kind" text DEFAULT 'user' NOT NULL,
	"created_by_name" text,
	"created_by_routine" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notes_project_idx" ON "notes" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "notes_updated_idx" ON "notes" USING btree ("updated_at");