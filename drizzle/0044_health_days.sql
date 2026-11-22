CREATE TABLE "health_days" (
	"date" date PRIMARY KEY NOT NULL,
	"summary" jsonb NOT NULL,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
