CREATE TYPE "public"."exercise_mode" AS ENUM('implement', 'debug', 'explain');--> statement-breakpoint
CREATE TYPE "public"."exercise_status" AS ENUM('pending', 'verified', 'failed', 'retired');--> statement-breakpoint
CREATE TABLE "exercise_concepts" (
	"exercise_id" uuid NOT NULL,
	"concept_id" uuid NOT NULL,
	CONSTRAINT "exercise_concepts_exercise_id_concept_id_pk" PRIMARY KEY("exercise_id","concept_id")
);
--> statement-breakpoint
CREATE TABLE "pre_flight_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"concept_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"passed" boolean NOT NULL,
	"diagnostics" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pre_flight_attempts_number_check" CHECK ("pre_flight_attempts"."attempt_number" between 1 and 3)
);
--> statement-breakpoint
ALTER TABLE "exercises" ALTER COLUMN "status" SET DEFAULT 'pending'::"public"."exercise_status";--> statement-breakpoint
ALTER TABLE "exercises" ALTER COLUMN "status" SET DATA TYPE "public"."exercise_status" USING "status"::"public"."exercise_status";--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "mode" "exercise_mode" DEFAULT 'implement' NOT NULL;--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "difficulty" integer NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE "exercises" ALTER COLUMN "difficulty" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "constraints" jsonb;--> statement-breakpoint
ALTER TABLE "exercise_concepts" ADD CONSTRAINT "exercise_concepts_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_concepts" ADD CONSTRAINT "exercise_concepts_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pre_flight_attempts" ADD CONSTRAINT "pre_flight_attempts_concept_id_concepts_id_fk" FOREIGN KEY ("concept_id") REFERENCES "public"."concepts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pre_flight_attempts_concept_idx" ON "pre_flight_attempts" USING btree ("concept_id");