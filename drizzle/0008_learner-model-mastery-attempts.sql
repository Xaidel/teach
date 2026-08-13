CREATE TYPE "public"."attempt_outcome" AS ENUM('pass', 'fail');--> statement-breakpoint
CREATE TYPE "public"."mastery_state" AS ENUM('unknown', 'introduced', 'practiced', 'demonstrated', 'retained');--> statement-breakpoint
CREATE TABLE "attempt_hints" (
	"id" uuid PRIMARY KEY NOT NULL,
	"attempt_id" uuid NOT NULL,
	"hint_level" integer NOT NULL,
	"content" text NOT NULL,
	"served_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attempt_hints_level_check" CHECK ("attempt_hints"."hint_level" between 0 and 5)
);
--> statement-breakpoint
CREATE TABLE "attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"learner_id" uuid NOT NULL,
	"exercise_id" uuid NOT NULL,
	"code" text NOT NULL,
	"outcome" "attempt_outcome" NOT NULL,
	"time_to_solution" integer NOT NULL,
	"compiler_errors" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learner_concept_mastery" (
	"learner_id" uuid NOT NULL,
	"concept_id" uuid NOT NULL,
	"state" "mastery_state" DEFAULT 'introduced' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learner_concept_mastery_learner_id_concept_id_pk" PRIMARY KEY("learner_id","concept_id")
);
--> statement-breakpoint
ALTER TABLE "attempt_hints" ADD CONSTRAINT "attempt_hints_attempt_id_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learner_concept_mastery" ADD CONSTRAINT "learner_concept_mastery_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learner_concept_mastery" ADD CONSTRAINT "learner_concept_mastery_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attempt_hints_attempt_idx" ON "attempt_hints" USING btree ("attempt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attempt_hints_level_unique" ON "attempt_hints" USING btree ("attempt_id","hint_level");--> statement-breakpoint
CREATE INDEX "attempts_learner_idx" ON "attempts" USING btree ("learner_id");--> statement-breakpoint
CREATE INDEX "attempts_exercise_idx" ON "attempts" USING btree ("exercise_id");--> statement-breakpoint
-- Data backfill (ADR-0010 staging-deviation reconciliation, ADR-0021):
-- `submissions` + `results` merge into `attempts`, reusing the submission's
-- id as the attempt's id 1:1 so `submission_hints` can be rekeyed onto
-- `attempt_hints` below without a lookup join. `time_to_solution` is backfilled
-- as elapsed seconds since the learner's earliest submission on that
-- exercise, matching the definition the application now writes going
-- forward (src/features/exercise/exercise.server.ts).
INSERT INTO "attempts" ("id", "learner_id", "exercise_id", "code", "outcome", "time_to_solution", "compiler_errors", "created_at")
SELECT
	s."id",
	s."learner_id",
	s."exercise_id",
	s."code",
	CASE WHEN r."passed" THEN 'pass' ELSE 'fail' END::"public"."attempt_outcome",
	EXTRACT(EPOCH FROM (s."created_at" - MIN(s."created_at") OVER (PARTITION BY s."learner_id", s."exercise_id")))::integer,
	jsonb_build_object('tests', r."tests", 'message', r."message"),
	s."created_at"
FROM "submissions" s
INNER JOIN "results" r ON r."submission_id" = s."id";
--> statement-breakpoint
INSERT INTO "attempt_hints" ("id", "attempt_id", "hint_level", "content", "served_at")
SELECT "id", "submission_id", "hint_level", "content", "served_at"
FROM "submission_hints";