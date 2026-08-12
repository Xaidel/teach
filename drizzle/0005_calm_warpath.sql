CREATE TYPE "public"."concept_edge_kind" AS ENUM('prerequisite', 'related');--> statement-breakpoint
CREATE TYPE "public"."concept_status" AS ENUM('draft', 'approved');--> statement-breakpoint
CREATE TABLE "concept_edges" (
	"from_concept_id" uuid NOT NULL,
	"to_concept_id" uuid NOT NULL,
	"kind" "concept_edge_kind" NOT NULL,
	CONSTRAINT "concept_edges_no_self_loop_check" CHECK ("concept_edges"."from_concept_id" <> "concept_edges"."to_concept_id")
);
--> statement-breakpoint
CREATE TABLE "concepts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"language" text NOT NULL,
	"slug" text NOT NULL,
	"difficulty" integer NOT NULL,
	"status" "concept_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "concepts_difficulty_range_check" CHECK ("concepts"."difficulty" between 1 and 5)
);
--> statement-breakpoint
ALTER TABLE "concept_edges" ADD CONSTRAINT "concept_edges_from_concept_id_concepts_id_fk" FOREIGN KEY ("from_concept_id") REFERENCES "public"."concepts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "concept_edges" ADD CONSTRAINT "concept_edges_to_concept_id_concepts_id_fk" FOREIGN KEY ("to_concept_id") REFERENCES "public"."concepts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "concept_edges_from_to_kind_unique" ON "concept_edges" USING btree ("from_concept_id","to_concept_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "concepts_language_slug_unique" ON "concepts" USING btree ("language","slug");