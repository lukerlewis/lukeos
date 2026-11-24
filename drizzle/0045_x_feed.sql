CREATE TABLE "x_people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"handle" text NOT NULL,
	"name" text,
	"avatar_url" text,
	"checked_at" timestamp with time zone,
	"created_by_kind" text DEFAULT 'user' NOT NULL,
	"created_by_name" text,
	"created_by_routine" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "x_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"x_id" text NOT NULL,
	"url" text NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"kind" text DEFAULT 'post' NOT NULL,
	"context" jsonb,
	"media" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"posted_at" timestamp with time zone NOT NULL,
	"created_by_kind" text DEFAULT 'user' NOT NULL,
	"created_by_name" text,
	"created_by_routine" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "x_posts_x_id_unique" UNIQUE("x_id")
);
--> statement-breakpoint
CREATE TABLE "x_replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"text" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"error" text,
	"reply_url" text,
	"sent_at" timestamp with time zone,
	"created_by_kind" text DEFAULT 'user' NOT NULL,
	"created_by_name" text,
	"created_by_routine" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "x_posts" ADD CONSTRAINT "x_posts_person_id_x_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."x_people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "x_replies" ADD CONSTRAINT "x_replies_post_id_x_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."x_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "x_people_handle_idx" ON "x_people" USING btree (lower("handle"));--> statement-breakpoint
CREATE INDEX "x_posts_posted_idx" ON "x_posts" USING btree ("posted_at");--> statement-breakpoint
CREATE INDEX "x_posts_person_idx" ON "x_posts" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "x_replies_post_idx" ON "x_replies" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "x_replies_status_idx" ON "x_replies" USING btree ("status");