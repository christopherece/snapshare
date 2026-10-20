CREATE TYPE "public"."host_role" AS ENUM('admin', 'host');--> statement-breakpoint
CREATE TABLE "host_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"note" varchar(120),
	"created_by" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"used_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "host_invites_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "hosts" ADD COLUMN "role" "host_role" DEFAULT 'host' NOT NULL;--> statement-breakpoint
ALTER TABLE "hosts" ADD COLUMN "disabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "host_invites" ADD CONSTRAINT "host_invites_created_by_hosts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."hosts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_invites" ADD CONSTRAINT "host_invites_used_by_hosts_id_fk" FOREIGN KEY ("used_by") REFERENCES "public"."hosts"("id") ON DELETE set null ON UPDATE no action;