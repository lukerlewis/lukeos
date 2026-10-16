CREATE TABLE "listen_episodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"show" text,
	"audio_url" text,
	"file_id" uuid,
	"file_name" text,
	"bytes" integer,
	"artwork_url" text,
	"description" text DEFAULT '' NOT NULL,
	"feed_url" text,
	"guid" text,
	"published_at" timestamp with time zone,
	"duration_seconds" integer,
	"position_seconds" integer DEFAULT 0 NOT NULL,
	"last_played_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"kept" boolean DEFAULT false NOT NULL,
	"created_by_kind" text DEFAULT 'user' NOT NULL,
	"created_by_name" text,
	"created_by_routine" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listen_playlist_items" (
	"playlist_id" uuid NOT NULL,
	"episode_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "listen_playlist_items_playlist_id_episode_id_pk" PRIMARY KEY("playlist_id","episode_id")
);
--> statement-breakpoint
CREATE TABLE "listen_playlists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"created_by_kind" text DEFAULT 'user' NOT NULL,
	"created_by_name" text,
	"created_by_routine" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "listen_episodes" ADD CONSTRAINT "listen_episodes_file_id_stored_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listen_playlist_items" ADD CONSTRAINT "listen_playlist_items_playlist_id_listen_playlists_id_fk" FOREIGN KEY ("playlist_id") REFERENCES "public"."listen_playlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listen_playlist_items" ADD CONSTRAINT "listen_playlist_items_episode_id_listen_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."listen_episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "listen_episodes_created_idx" ON "listen_episodes" USING btree ("created_at");