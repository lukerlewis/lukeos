CREATE TABLE "routine_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"routine_id" uuid NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"agent_name" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"summary" text,
	"artifact_id" uuid,
	CONSTRAINT "routine_runs_once" UNIQUE("routine_id","due_at")
);
--> statement-breakpoint
CREATE TABLE "routines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"sop_id" uuid,
	"frequency" text DEFAULT 'daily' NOT NULL,
	"time" text DEFAULT '20:00' NOT NULL,
	"days" integer[] DEFAULT '{1,2,3,4,5}' NOT NULL,
	"day_of_month" integer DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"scheduled_from" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_kind" text DEFAULT 'user' NOT NULL,
	"created_by_name" text,
	"created_by_routine" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "routine_runs" ADD CONSTRAINT "routine_runs_routine_id_routines_id_fk" FOREIGN KEY ("routine_id") REFERENCES "public"."routines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "routine_runs_due_idx" ON "routine_runs" USING btree ("due_at");