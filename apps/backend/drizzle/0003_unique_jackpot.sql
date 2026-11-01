CREATE TYPE "public"."report_reason" AS ENUM('inappropriate', 'me', 'other');--> statement-breakpoint
CREATE TABLE "photo_reports" (
	"photo_id" uuid NOT NULL,
	"guest_id" uuid NOT NULL,
	"reason" "report_reason" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "photo_reports_photo_id_guest_id_pk" PRIMARY KEY("photo_id","guest_id")
);
--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "report_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "photo_reports" ADD CONSTRAINT "photo_reports_photo_id_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_reports" ADD CONSTRAINT "photo_reports_guest_id_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guests"("id") ON DELETE cascade ON UPDATE no action;