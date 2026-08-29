DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'detection_type' AND e.enumlabel = 'anonymous') THEN
        ALTER TYPE "public"."detection_type" ADD VALUE 'anonymous';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'detection_type' AND e.enumlabel = 'dark_environment') THEN
        ALTER TYPE "public"."detection_type" ADD VALUE 'dark_environment';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'detection_type' AND e.enumlabel = 'blurry_image') THEN
        ALTER TYPE "public"."detection_type" ADD VALUE 'blurry_image';
    END IF;
END
$$;
--> statement-breakpoint
ALTER TABLE "detection_events" ADD COLUMN IF NOT EXISTS "bounding_box" text;