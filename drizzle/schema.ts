import {
  integer,
  text,
  real,
  serial,
  timestamp,
  boolean,
  pgTable,
  pgEnum,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * PostgreSQL version using serial autoincrement and PostgreSQL types
 */

// Enums for PostgreSQL
export const roleEnum = pgEnum("role", ["user", "admin"]);
export const statusEnum = pgEnum("status", ["online", "offline", "error"]);
export const sensitivityEnum = pgEnum("sensitivity", ["low", "medium", "high"]);
export const detectionTypeEnum = pgEnum("detection_type", ["human", "animal", "vehicle", "anonymous", "dark_environment", "blurry_image"]);
export const verificationStatusEnum = pgEnum("verification_status", ["pending", "verified", "rejected"]);
export const droneMissionStatusEnum = pgEnum("drone_mission_status", ["pending", "launched", "in_progress", "completed", "failed", "cancelled"]);
export const verificationResultEnum = pgEnum("verification_result", ["confirmed", "false_alarm", "inconclusive"]);
export const alertTypeEnum = pgEnum("alert_type", [
  "critical_detection",
  "drone_deployed",
  "drone_completed",
  "false_alarm",
  "low_battery",
  "signal_lost",
  "system_alert",
  "ranger_response",
]);
export const alertStatusEnum = pgEnum("alert_status", ["sent", "delivered", "read", "failed"]);
export const alertChannelEnum = pgEnum("alert_channel", ["push", "email", "sms"]);
export const themeEnum = pgEnum("theme", ["light", "dark"]);
export const motionSensitivityEnum = pgEnum("motion_sensitivity", ["low", "medium", "high"]);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 320 }).notNull().unique(),
  name: varchar("name"),
  role: roleEnum("role").default("user").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  lastSignedIn: timestamp("last_signed_in").defaultNow(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// Camera Stations table
export const cameraStations = pgTable("camera_stations", {
  id: varchar("id", { length: 64 }).primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  status: statusEnum("status").default("offline").notNull(),
  latitude: real("latitude").notNull(),
  longitude: real("longitude").notNull(),
  sensitivity: sensitivityEnum("sensitivity").default("medium").notNull(),
  alertThreshold: real("alert_threshold").default(0.85).notNull(),
  lastDetectionTime: timestamp("last_detection_time"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type CameraStation = typeof cameraStations.$inferSelect;
export type InsertCameraStation = typeof cameraStations.$inferInsert;

// Detection Events table
export const detectionEvents = pgTable("detection_events", {
  id: varchar("id", { length: 64 }).primaryKey(),
  type: detectionTypeEnum("type").notNull(),
  confidence: real("confidence").notNull(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  stationId: varchar("station_id", { length: 64 }).notNull(),
  imageUrl: text("image_url"),
  imageData: text("image_data"),
  latitude: real("latitude"),
  longitude: real("longitude"),
  boundingBox: text("bounding_box"),
  verificationStatus: verificationStatusEnum("verification_status").default("pending").notNull(),
  verifiedBy: integer("verified_by"),
  verifiedAt: timestamp("verified_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type DetectionEvent = typeof detectionEvents.$inferSelect;
export type InsertDetectionEvent = typeof detectionEvents.$inferInsert;

// Drone Missions table
export const droneMissions = pgTable("drone_missions", {
  id: varchar("id", { length: 64 }).primaryKey(),
  detectionEventId: varchar("detection_event_id", { length: 64 }).notNull(),
  droneId: varchar("drone_id", { length: 64 }),
  status: droneMissionStatusEnum("status").default("pending").notNull(),
  targetLatitude: real("target_latitude").notNull(),
  targetLongitude: real("target_longitude").notNull(),
  verificationResult: verificationResultEnum("verification_result"),
  footageUrl: text("footage_url"),
  launchedAt: timestamp("launched_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type DroneMission = typeof droneMissions.$inferSelect;
export type InsertDroneMission = typeof droneMissions.$inferInsert;

// Alerts table
export const alerts = pgTable("alerts", {
  id: varchar("id", { length: 64 }).primaryKey(),
  alertType: alertTypeEnum("alert_type").notNull(),
  recipientId: integer("recipient_id").notNull(),
  status: alertStatusEnum("status").default("sent").notNull(),
  channel: alertChannelEnum("channel").default("push").notNull(),
  data: text("data"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  readAt: timestamp("read_at"),
});

export type Alert = typeof alerts.$inferSelect;
export type InsertAlert = typeof alerts.$inferInsert;

// Detection Patterns table
export const patterns = pgTable("patterns", {
  id: varchar("id", { length: 64 }).primaryKey(),
  stationId: varchar("station_id", { length: 64 }).notNull(),
  detectionType: detectionTypeEnum("detection_type").notNull(),
  hourOfDay: integer("hour_of_day"),
  dayOfWeek: integer("day_of_week"),
  frequency: integer("frequency").default(0).notNull(),
  averageConfidence: real("average_confidence"),
  lastOccurrence: timestamp("last_occurrence"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Pattern = typeof patterns.$inferSelect;
export type InsertPattern = typeof patterns.$inferInsert;

// User Preferences table
export const userPreferences = pgTable("user_preferences", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  theme: themeEnum("theme").default("light").notNull(),
  confidenceThreshold: real("confidence_threshold").default(0.85).notNull(),
  motionSensitivity: motionSensitivityEnum("motion_sensitivity").default("medium").notNull(),
  droneCruiseSpeed: real("drone_cruise_speed").default(15).notNull(),
  droneMaxAltitude: real("drone_max_altitude").default(400).notNull(),
  droneGeofenceRadius: real("drone_geofence_radius").default(5000).notNull(),
  offlineSyncRetryInterval: integer("offline_sync_retry_interval").default(30000).notNull(),
  offlineSyncMaxQueueSize: integer("offline_sync_max_queue_size").default(1000).notNull(),
  notificationsEnabled: boolean("notifications_enabled").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type UserPreference = typeof userPreferences.$inferSelect;
export type InsertUserPreference = typeof userPreferences.$inferInsert;

// Ranger Contacts table
export const rangerContacts = pgTable("ranger_contacts", {
  id: varchar("id", { length: 64 }).primaryKey(),
  userId: integer("user_id").notNull(),
  fcmToken: text("fcm_token").notNull(),
  deviceName: varchar("device_name", { length: 255 }),
  deviceId: varchar("device_id", { length: 255 }).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  lastUsed: timestamp("last_used"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type RangerContact = typeof rangerContacts.$inferSelect;
export type InsertRangerContact = typeof rangerContacts.$inferInsert;

// Alert Logs table (Audit trail)
export const alertLogs = pgTable("alert_logs", {
  id: varchar("id", { length: 64 }).primaryKey(),
  alertId: varchar("alert_id", { length: 64 }).notNull(),
  action: varchar("action", { length: 255 }).notNull(),
  performedBy: integer("performed_by"),
  details: text("details"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type AlertLog = typeof alertLogs.$inferSelect;
export type InsertAlertLog = typeof alertLogs.$inferInsert;

// OTP Verification table
export const otpVerifications = pgTable("otp_verifications", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 320 }).notNull(),
  otp: varchar("otp", { length: 6 }).notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  isUsed: boolean("is_used").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type OtpVerification = typeof otpVerifications.$inferSelect;
export type InsertOtpVerification = typeof otpVerifications.$inferInsert;
