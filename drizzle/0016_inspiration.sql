CREATE TABLE "inspiration_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"url" text,
	"body" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"summary" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"project_id" uuid,
	"image_id" uuid,
	"thumb_id" uuid,
	"width" integer,
	"height" integer,
	"file_id" uuid,
	"file_name" text,
	"tagged_at" timestamp with time zone,
	"created_by_kind" text DEFAULT 'user' NOT NULL,
	"created_by_name" text,
	"created_by_routine" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "stored_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"backend" text NOT NULL,
	"blob_url" text,
	"access" text,
	"mime_type" text NOT NULL,
	"bytes" integer NOT NULL,
	"data" "bytea",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inspiration_items" ADD CONSTRAINT "inspiration_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspiration_items" ADD CONSTRAINT "inspiration_items_image_id_stored_files_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."stored_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspiration_items" ADD CONSTRAINT "inspiration_items_thumb_id_stored_files_id_fk" FOREIGN KEY ("thumb_id") REFERENCES "public"."stored_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspiration_items" ADD CONSTRAINT "inspiration_items_file_id_stored_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inspiration_items_created_idx" ON "inspiration_items" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "inspiration_items_project_idx" ON "inspiration_items" USING btree ("project_id");