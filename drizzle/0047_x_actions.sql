CREATE TABLE "x_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"want" boolean DEFAULT true NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "x_actions" ADD CONSTRAINT "x_actions_post_id_x_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."x_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "x_actions_post_kind_idx" ON "x_actions" USING btree ("post_id","kind");