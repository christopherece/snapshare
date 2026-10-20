ALTER TABLE "events" ADD COLUMN "suspended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "host_invites" ADD COLUMN "email" varchar(255);