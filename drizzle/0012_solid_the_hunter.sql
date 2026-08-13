CREATE TYPE "public"."exercise_guidance" AS ENUM('guided', 'independent');--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "guidance" "exercise_guidance" DEFAULT 'guided' NOT NULL;