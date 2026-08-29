CREATE TABLE `alert_logs` (
	`id` text(64) PRIMARY KEY NOT NULL,
	`alertId` text(64) NOT NULL,
	`action` text(255) NOT NULL,
	`performedBy` integer,
	`details` text,
	`createdAt` integer
);
--> statement-breakpoint
CREATE TABLE `alerts` (
	`id` text(64) PRIMARY KEY NOT NULL,
	`alertType` text NOT NULL,
	`recipientId` integer NOT NULL,
	`status` text DEFAULT 'sent' NOT NULL,
	`channel` text DEFAULT 'push' NOT NULL,
	`data` text,
	`createdAt` integer,
	`readAt` integer
);
--> statement-breakpoint
CREATE TABLE `camera_stations` (
	`id` text(64) PRIMARY KEY NOT NULL,
	`name` text(255) NOT NULL,
	`status` text DEFAULT 'offline' NOT NULL,
	`latitude` real NOT NULL,
	`longitude` real NOT NULL,
	`sensitivity` text DEFAULT 'medium' NOT NULL,
	`alertThreshold` real DEFAULT 0.85 NOT NULL,
	`lastDetectionTime` integer,
	`createdAt` integer,
	`updatedAt` integer
);
--> statement-breakpoint
CREATE TABLE `detection_events` (
	`id` text(64) PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`confidence` real NOT NULL,
	`timestamp` integer,
	`stationId` text(64) NOT NULL,
	`imageUrl` text,
	`imageData` text,
	`latitude` real,
	`longitude` real,
	`verificationStatus` text DEFAULT 'pending' NOT NULL,
	`verifiedBy` integer,
	`verifiedAt` integer,
	`createdAt` integer
);
--> statement-breakpoint
CREATE TABLE `drone_missions` (
	`id` text(64) PRIMARY KEY NOT NULL,
	`detectionEventId` text(64) NOT NULL,
	`droneId` text(64),
	`status` text DEFAULT 'pending' NOT NULL,
	`targetLatitude` real NOT NULL,
	`targetLongitude` real NOT NULL,
	`verificationResult` text,
	`footageUrl` text,
	`launchedAt` integer,
	`completedAt` integer,
	`createdAt` integer,
	`updatedAt` integer
);
--> statement-breakpoint
CREATE TABLE `patterns` (
	`id` text(64) PRIMARY KEY NOT NULL,
	`stationId` text(64) NOT NULL,
	`detectionType` text NOT NULL,
	`hourOfDay` integer,
	`dayOfWeek` integer,
	`frequency` integer DEFAULT 0 NOT NULL,
	`averageConfidence` real,
	`lastOccurrence` integer,
	`createdAt` integer,
	`updatedAt` integer
);
--> statement-breakpoint
CREATE TABLE `ranger_contacts` (
	`id` text(64) PRIMARY KEY NOT NULL,
	`userId` integer NOT NULL,
	`fcmToken` text NOT NULL,
	`deviceName` text(255),
	`deviceId` text(255) NOT NULL,
	`isActive` integer DEFAULT true NOT NULL,
	`lastUsed` integer,
	`createdAt` integer,
	`updatedAt` integer
);
--> statement-breakpoint
CREATE TABLE `user_preferences` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`userId` integer NOT NULL,
	`theme` text DEFAULT 'light' NOT NULL,
	`confidenceThreshold` real DEFAULT 0.85 NOT NULL,
	`motionSensitivity` text DEFAULT 'medium' NOT NULL,
	`droneCruiseSpeed` real DEFAULT 15 NOT NULL,
	`droneMaxAltitude` real DEFAULT 400 NOT NULL,
	`droneGeofenceRadius` real DEFAULT 5000 NOT NULL,
	`offlineSyncRetryInterval` integer DEFAULT 30000 NOT NULL,
	`offlineSyncMaxQueueSize` integer DEFAULT 1000 NOT NULL,
	`notificationsEnabled` integer DEFAULT true NOT NULL,
	`createdAt` integer,
	`updatedAt` integer
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`openId` text(64) NOT NULL,
	`name` text,
	`email` text(320),
	`loginMethod` text(64),
	`role` text DEFAULT 'user' NOT NULL,
	`createdAt` integer,
	`updatedAt` integer,
	`lastSignedIn` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_openId_unique` ON `users` (`openId`);