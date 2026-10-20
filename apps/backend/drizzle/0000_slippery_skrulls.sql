CREATE TYPE "public"."moderation_status" AS ENUM('pending', 'approved', 'hidden');--> statement-breakpoint
CREATE TYPE "public"."photo_status" AS ENUM('pending_upload', 'uploaded', 'processing', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" uuid NOT NULL,
	"slug" varchar(32) NOT NULL,
	"name" varchar(160) NOT NULL,
	"location" varchar(255),
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"passcode_hash" text,
	"require_approval" boolean DEFAULT false NOT NULL,
	"uploads_open" boolean DEFAULT true NOT NULL,
	"display_key" varchar(64) NOT NULL,
	"cover_key" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "guests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"device_id" varchar(64) NOT NULL,
	"display_name" varchar(60),
	"token_hash" varchar(64) NOT NULL,
	"is_blocked" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guests_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "hosts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" text NOT NULL,
	"name" varchar(120) NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hosts_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "photo_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"photo_id" uuid NOT NULL,
	"guest_id" uuid,
	"body" varchar(280) NOT NULL,
	"is_hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "photo_likes" (
	"photo_id" uuid NOT NULL,
	"guest_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "photo_likes_photo_id_guest_id_pk" PRIMARY KEY("photo_id","guest_id")
);
--> statement-breakpoint
CREATE TABLE "photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"guest_id" uuid,
	"client_id" varchar(64) NOT NULL,
	"status" "photo_status" DEFAULT 'pending_upload' NOT NULL,
	"moderation" "moderation_status" DEFAULT 'approved' NOT NULL,
	"is_favorite" boolean DEFAULT false NOT NULL,
	"original_key" text NOT NULL,
	"thumb_key" text,
	"display_key" text,
	"mime_type" varchar(64) DEFAULT 'image/jpeg' NOT NULL,
	"size_bytes" integer,
	"width" integer,
	"height" integer,
	"taken_at" timestamp with time zone,
	"exif" jsonb,
	"like_count" integer DEFAULT 0 NOT NULL,
	"processing_attempts" integer DEFAULT 0 NOT NULL,
	"processing_error" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_host_id_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."hosts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guests" ADD CONSTRAINT "guests_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_comments" ADD CONSTRAINT "photo_comments_photo_id_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_comments" ADD CONSTRAINT "photo_comments_guest_id_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_likes" ADD CONSTRAINT "photo_likes_photo_id_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_likes" ADD CONSTRAINT "photo_likes_guest_id_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photos" ADD CONSTRAINT "photos_guest_id_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_host_idx" ON "events" USING btree ("host_id");--> statement-breakpoint
CREATE UNIQUE INDEX "guests_event_device_uq" ON "guests" USING btree ("event_id","device_id");--> statement-breakpoint
CREATE INDEX "photo_comments_photo_idx" ON "photo_comments" USING btree ("photo_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "photos_guest_client_uq" ON "photos" USING btree ("guest_id","client_id");--> statement-breakpoint
CREATE INDEX "photos_event_feed_idx" ON "photos" USING btree ("event_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "photos"."status" = 'ready';--> statement-breakpoint
CREATE INDEX "photos_status_idx" ON "photos" USING btree ("status");