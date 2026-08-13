ALTER TABLE "learners" ADD COLUMN "explanation_depth" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "learners" ADD COLUMN "reference_frame" text;--> statement-breakpoint
ALTER TABLE "learners" ADD CONSTRAINT "learners_explanation_depth_check" CHECK ("learners"."explanation_depth" between 1 and 5);