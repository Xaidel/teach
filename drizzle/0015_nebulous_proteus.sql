CREATE TABLE "curriculum_lessons" (
	"id" uuid PRIMARY KEY NOT NULL,
	"learner_id" uuid NOT NULL,
	"concept_id" uuid NOT NULL,
	"explanation_depth" integer NOT NULL,
	"reference_frame" text,
	"explanation" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "curriculum_lessons" ADD CONSTRAINT "curriculum_lessons_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curriculum_lessons" ADD CONSTRAINT "curriculum_lessons_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "curriculum_lessons_cache_key_unique" ON "curriculum_lessons" USING btree ("learner_id","concept_id","explanation_depth",coalesce("reference_frame", ''));