CREATE TABLE "submission_hints" (
	"id" uuid PRIMARY KEY NOT NULL,
	"submission_id" uuid NOT NULL,
	"hint_level" integer NOT NULL,
	"content" text NOT NULL,
	"served_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "submission_hints_level_check" CHECK ("submission_hints"."hint_level" between 0 and 5)
);
--> statement-breakpoint
ALTER TABLE "results" ADD COLUMN "message" text;--> statement-breakpoint
ALTER TABLE "submission_hints" ADD CONSTRAINT "submission_hints_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "submission_hints_submission_idx" ON "submission_hints" USING btree ("submission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "submission_hints_level_unique" ON "submission_hints" USING btree ("submission_id","hint_level");