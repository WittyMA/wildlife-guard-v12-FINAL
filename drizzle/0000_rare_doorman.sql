CREATE TYPE "public"."alert_channel" AS ENUM('push', 'email', 'sms');--> statement-breakpoint
CREATE TYPE "public"."alert_status" AS ENUM('sent', 'delivered', 'read', 'failed');--> statement-breakpoint
CREATE TYPE "public"."alert_type" AS ENUM('critical_detection', 'drone_deployed', 'drone_completed', 'false_alarm', 'low_battery', 'signal_lost', 'system_alert', 'ranger_response');--> statement-breakpoint
CREATE TYPE "public"."detection_type" AS ENUM('human', 'animal', 'vehicle');--> statement-breakpoint
CREATE TYPE "public"."drone_mission_status" AS ENUM('pending', 'launched', 'in_progress', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."motion_sensitivity" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TYPE "public"."sensitivity" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."status" AS ENUM('online', 'offline', 'error');--> statement-breakpoint
CREATE TYPE "public"."theme" AS ENUM('light', 'dark');--> statement-breakpoint
CREATE TYPE "public"."verification_result" AS ENUM('confirmed', 'false_alarm', 'inconclusive');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('pending', 'verified', 'rejected');--> statement-breakpoint
CREATE TABLE "alert_logs" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"alert_id" varchar(64) NOT NULL,
	"action" varchar(255) NOT NULL,
	"performed_by" integer,
	"details" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"alert_type" "alert_type" NOT NULL,
	"recipient_id" integer NOT NULL,
	"status" "alert_status" DEFAULT 'sent' NOT NULL,
	"channel" "alert_channel" DEFAULT 'push' NOT NULL,
	"data" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"read_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "camera_stations" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"status" "status" DEFAULT 'offline' NOT NULL,
	"latitude" real NOT NULL,
	"longitude" real NOT NULL,
	"sensitivity" "sensitivity" DEFAULT 'medium' NOT NULL,
	"alert_threshold" real DEFAULT 0.85 NOT NULL,
	"last_detection_time" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "detection_events" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"type" "detection_type" NOT NULL,
	"confidence" real NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"station_id" varchar(64) NOT NULL,
	"image_url" text,
	"image_data" text,
	"latitude" real,
	"longitude" real,
	"verification_status" "verification_status" DEFAULT 'pending' NOT NULL,
	"verified_by" integer,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drone_missions" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"detection_event_id" varchar(64) NOT NULL,
	"drone_id" varchar(64),
	"status" "drone_mission_status" DEFAULT 'pending' NOT NULL,
	"target_latitude" real NOT NULL,
	"target_longitude" real NOT NULL,
	"verification_result" "verification_result",
	"footage_url" text,
	"launched_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "otp_verifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" varchar(320) NOT NULL,
	"otp" varchar(6) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"is_used" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patterns" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"station_id" varchar(64) NOT NULL,
	"detection_type" "detection_type" NOT NULL,
	"hour_of_day" integer,
	"day_of_week" integer,
	"frequency" integer DEFAULT 0 NOT NULL,
	"average_confidence" real,
	"last_occurrence" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ranger_contacts" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"fcm_token" text NOT NULL,
	"device_name" varchar(255),
	"device_id" varchar(255) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_used" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"theme" "theme" DEFAULT 'light' NOT NULL,
	"confidence_threshold" real DEFAULT 0.85 NOT NULL,
	"motion_sensitivity" "motion_sensitivity" DEFAULT 'medium' NOT NULL,
	"drone_cruise_speed" real DEFAULT 15 NOT NULL,
	"drone_max_altitude" real DEFAULT 400 NOT NULL,
	"drone_geofence_radius" real DEFAULT 5000 NOT NULL,
	"offline_sync_retry_interval" integer DEFAULT 30000 NOT NULL,
	"offline_sync_max_queue_size" integer DEFAULT 1000 NOT NULL,
	"notifications_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" varchar(320) NOT NULL,
	"name" varchar,
	"role" "role" DEFAULT 'user' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"last_signed_in" timestamp DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
