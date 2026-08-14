CREATE TABLE "retrieval_queue" (
	"learner_id" uuid NOT NULL,
	"concept_id" uuid NOT NULL,
	"schedule_stage" integer DEFAULT 0 NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"priority_score" double precision NOT NULL,
	CONSTRAINT "retrieval_queue_learner_id_concept_id_pk" PRIMARY KEY("learner_id","concept_id"),
	CONSTRAINT "retrieval_queue_schedule_stage_check" CHECK ("retrieval_queue"."schedule_stage" between 0 and 4)
);
--> statement-breakpoint
CREATE TABLE "retrieval_review_exercises" (
	"id" uuid PRIMARY KEY NOT NULL,
	"learner_id" uuid NOT NULL,
	"concept_id" uuid NOT NULL,
	"exercise_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "retrieval_queue" ADD CONSTRAINT "retrieval_queue_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval_queue" ADD CONSTRAINT "retrieval_queue_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval_review_exercises" ADD CONSTRAINT "retrieval_review_exercises_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval_review_exercises" ADD CONSTRAINT "retrieval_review_exercises_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval_review_exercises" ADD CONSTRAINT "retrieval_review_exercises_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "retrieval_queue_learner_due_idx" ON "retrieval_queue" USING btree ("learner_id","due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "retrieval_review_exercises_learner_concept_unique" ON "retrieval_review_exercises" USING btree ("learner_id","concept_id");