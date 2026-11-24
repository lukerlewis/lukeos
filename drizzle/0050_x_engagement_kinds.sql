-- x_engagements was created minutes earlier (0049) and holds nothing yet: rebuild it with kinds (reply, mention, like, dm).
DROP TABLE IF EXISTS "x_engagements";--> statement-breakpoint
CREATE TABLE "x_engagements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"kind" text DEFAULT 'reply' NOT NULL,
	"key" text NOT NULL,
	"url" text,
	"text" text DEFAULT '' NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "x_engagements_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "x_engagements" ADD CONSTRAINT "x_engagements_person_id_x_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."x_people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "x_engagements_person_idx" ON "x_engagements" USING btree ("person_id","at");
