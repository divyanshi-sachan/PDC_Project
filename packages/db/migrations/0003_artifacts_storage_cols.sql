ALTER TABLE "artifacts" ADD COLUMN "storage_key" text NOT NULL;--> statement-breakpoint
ALTER TABLE "artifacts" ADD COLUMN "content_type" text NOT NULL;--> statement-breakpoint
ALTER TABLE "artifacts" ADD COLUMN "size_bytes" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_storage_key_unique" UNIQUE("storage_key");