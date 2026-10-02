CREATE TABLE "archive_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"size" text DEFAULT 'win' NOT NULL,
	"stage" text DEFAULT 'raw' NOT NULL,
	"story" text DEFAULT '' NOT NULL,
	"company" text,
	"role" text,
	"period" text,
	"outcome" text,
	"confidential" boolean DEFAULT false NOT NULL,
	"created_by_kind" text DEFAULT 'user' NOT NULL,
	"created_by_name" text,
	"created_by_routine" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "archive_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"url" text,
	"mime_type" text,
	"bytes" integer,
	"data" "bytea",
	"created_by_kind" text DEFAULT 'user' NOT NULL,
	"created_by_name" text,
	"created_by_routine" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "archive_files" ADD CONSTRAINT "archive_files_entry_id_archive_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."archive_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "archive_entries_updated_idx" ON "archive_entries" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "archive_files_entry_idx" ON "archive_files" USING btree ("entry_id");