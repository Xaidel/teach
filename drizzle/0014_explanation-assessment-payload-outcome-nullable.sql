ALTER TABLE "attempts" ALTER COLUMN "outcome" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "attempts" ADD COLUMN "explanation_assessment" jsonb;