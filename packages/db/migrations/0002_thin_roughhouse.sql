ALTER TABLE "places" ADD COLUMN "stage" text DEFAULT 'kept' NOT NULL;--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "idea" text;--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "batch_id" text;--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "build_state" text;--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "build_note" text;--> statement-breakpoint
ALTER TABLE "places" ADD COLUMN "submitted_at" timestamp with time zone;