import { eq, desc, and, gte, lte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  InsertUser,
  users,
  detectionEvents,
  cameraStations,
  droneMissions,
  alerts,
  rangerContacts,
  userPreferences,
  patterns,
  alertLogs,
  otpVerifications,
  DetectionEvent,
  CameraStation,
  DroneMission,
  Alert,
  RangerContact,
  UserPreference,
  Pattern,
  AlertLog,
  OtpVerification,
} from "../drizzle/schema";
import { ENV } from './_core/env';
import {
  fallbackCreateOtp,
  fallbackGetOtp,
  fallbackMarkOtpUsed,
  fallbackUpsertUser,
  fallbackGetUserByEmail,
  fallbackGetUserById,
  type FallbackOtpRecord,
  type FallbackUserRecord,
} from './_core/otpFallbackStore';

function fallbackRecordToUser(r: FallbackUserRecord): any {
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    role: r.role,
    lastSignedIn: r.lastSignedIn ? new Date(r.lastSignedIn) : null,
    createdAt: new Date(r.createdAt),
    updatedAt: new Date(r.updatedAt),
  };
}

// Tracks whether an OTP id originated from the local fallback store, so that
// markOtpAsUsed routes the update to the correct backend.
const fallbackOtpIds = new Set<number>();

let _db: ReturnType<typeof drizzle> | null = null;
let _client: ReturnType<typeof postgres> | null = null;
let _dbConnected = false;
let _dbLastAttempt = 0;
const DB_RETRY_INTERVAL = 30000; // Retry connection every 30 seconds

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  // If already connected, return existing instance
  if (_db && _dbConnected) return _db;

  // Rate-limit reconnection attempts
  const now = Date.now();
  if (!_db && (now - _dbLastAttempt) < DB_RETRY_INTERVAL) {
    return null;
  }
  _dbLastAttempt = now;

  if (!process.env.DATABASE_URL) {
    console.warn("[Database] DATABASE_URL not set - running in offline mode");
    return null;
  }

  try {
    _client = postgres(process.env.DATABASE_URL, {
      ssl: {
        rejectUnauthorized: false,
      },
      prepare: false,
      connect_timeout: 10, // 10 second connection timeout
      idle_timeout: 20,
      max: 3, // Limit pool size
    });
    _db = drizzle(_client);
    
    // Test the connection with a simple query
    await _client`SELECT 1`;
    _dbConnected = true;
    console.log("[Database] Connected successfully");
  } catch (error: any) {
    console.warn(`[Database] Connection failed (will retry in ${DB_RETRY_INTERVAL/1000}s):`, error?.code || error?.message || 'Unknown error');
    _db = null;
    _client = null;
    _dbConnected = false;
  }

  return _db;
}

export async function closeDb() {
  if (_client) {
    await _client.end();
    _client = null;
    _db = null;
  }
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.email) {
    throw new Error("User email is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Unreachable; upserting user to local fallback store");
    fallbackUpsertUser({
      email: user.email,
      name: user.name,
      role: user.role,
      lastSignedIn: user.lastSignedIn ?? null,
    });
    return;
  }

  try {
    const values: InsertUser = {
      email: user.email,
    };

    const textFields = ["name"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      values[field] = value ?? null;
    };

    textFields.forEach(assignNullable);

    if (user.role !== undefined) {
      values.role = user.role;
    } else {
      values.role = "user";
    }

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    // Upsert using PostgreSQL ON CONFLICT
    await db.insert(users).values(values).onConflictDoUpdate({
      target: users.email,
      set: {
        name: values.name,
        role: values.role,
        lastSignedIn: values.lastSignedIn,
        updatedAt: new Date(),
      },
    });
  } catch (error: any) {
    console.warn("[Database] upsert user failed; using local fallback store:", error?.code || error?.message);
    fallbackUpsertUser({
      email: user.email,
      name: user.name,
      role: user.role,
      lastSignedIn: user.lastSignedIn ?? null,
    });
  }
}

export async function getUserByEmail(email: string) {
  const db = await getDb();
  if (!db) {
    const rec = fallbackGetUserByEmail(email);
    return rec ? fallbackRecordToUser(rec) : undefined;
  }

  try {
    const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (result.length > 0) return result[0];
  } catch (error: any) {
    console.warn("[Database] getUserByEmail failed; checking fallback store:", error?.code || error?.message);
    const rec = fallbackGetUserByEmail(email);
    return rec ? fallbackRecordToUser(rec) : undefined;
  }

  // Not found in DB: also check fallback (covers users created during an outage).
  const rec = fallbackGetUserByEmail(email);
  return rec ? fallbackRecordToUser(rec) : undefined;
}

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) {
    const rec = fallbackGetUserById(id);
    return rec ? fallbackRecordToUser(rec) : undefined;
  }

  try {
    const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (result.length > 0) return result[0];
  } catch (error: any) {
    console.warn("[Database] getUserById failed; checking fallback store:", error?.code || error?.message);
  }

  const rec = fallbackGetUserById(id);
  return rec ? fallbackRecordToUser(rec) : undefined;
}

// Detection Events queries
export async function createDetectionEvent(data: any): Promise<DetectionEvent> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(detectionEvents).values(data).returning();
  return result[0];
}

export async function getDetectionEvents(stationId?: string, limit = 50, offset = 0) {
  const db = await getDb();
  if (!db) return [];

  if (stationId) {
    return db.select().from(detectionEvents)
      .where(eq(detectionEvents.stationId, stationId))
      .orderBy(desc(detectionEvents.timestamp))
      .limit(limit)
      .offset(offset);
  }

  return db.select().from(detectionEvents)
    .orderBy(desc(detectionEvents.timestamp))
    .limit(limit)
    .offset(offset);
}

export async function getDetectionEventById(id: string) {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db.select().from(detectionEvents).where(eq(detectionEvents.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function updateDetectionVerification(id: string, verifiedBy: number, status: 'verified' | 'rejected') {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(detectionEvents)
    .set({
      verificationStatus: status,
      verifiedBy,
      verifiedAt: new Date(),
    })
    .where(eq(detectionEvents.id, id));
}

// Camera Stations queries
export async function createCameraStation(data: any): Promise<CameraStation> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(cameraStations).values(data).returning();
  return result[0];
}

export async function getCameraStations() {
  try {
    const db = await getDb();
    if (!db) return [];
    return await db.select().from(cameraStations);
  } catch (error: any) {
    console.warn("[Database] getCameraStations failed:", error?.code || error?.message);
    return [];
  }
}

export async function getCameraStationById(id: string) {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db.select().from(cameraStations).where(eq(cameraStations.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function updateCameraStation(id: string, data: any) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(cameraStations).set(data).where(eq(cameraStations.id, id));
}

// Drone Missions queries

/**
 * Check if a drone mission was already created for a given station within the cooldown period.
 * This prevents mission spam when the detection engine fires repeatedly for the same scene.
 * @param stationId - The camera station ID
 * @param cooldownMs - Cooldown period in milliseconds (default: 5 minutes)
 * @returns true if a recent mission exists (should NOT create another)
 */
export async function hasRecentDroneMission(stationId: string, cooldownMs = 300000): Promise<boolean> {
  const db = await getDb();
  if (!db) return false; // If DB is offline, allow (will fail at createDroneMission anyway)

  try {
    const cutoff = new Date(Date.now() - cooldownMs);
    // Join droneMissions with detectionEvents to filter by stationId
    const results = await db
      .select({ id: droneMissions.id })
      .from(droneMissions)
      .innerJoin(detectionEvents, eq(droneMissions.detectionEventId, detectionEvents.id))
      .where(
        and(
          eq(detectionEvents.stationId, stationId),
          gte(droneMissions.createdAt, cutoff)
        )
      )
      .limit(1);

    return results.length > 0;
  } catch (error) {
    console.warn('[DB] hasRecentDroneMission check failed:', error);
    return false; // On error, allow mission creation
  }
}

export async function createDroneMission(data: any): Promise<DroneMission> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(droneMissions).values(data).returning();
  return result[0];
}

export async function getDroneMissionById(id: string) {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db.select().from(droneMissions).where(eq(droneMissions.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function updateDroneMission(id: string, data: any) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(droneMissions).set(data).where(eq(droneMissions.id, id));
}

// Ranger Contacts queries
export async function createRangerContact(data: any): Promise<RangerContact> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(rangerContacts).values(data).returning();
  return result[0];
}

export async function getRangerContactsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];

  return db.select().from(rangerContacts).where(eq(rangerContacts.userId, userId));
}

export async function getRangerContactById(id: string) {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db.select().from(rangerContacts).where(eq(rangerContacts.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function updateRangerContact(id: string, data: any) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(rangerContacts).set(data).where(eq(rangerContacts.id, id));
}

export async function getAllActiveRangerContacts() {
  const db = await getDb();
  if (!db) return [];

  return db.select().from(rangerContacts).where(eq(rangerContacts.isActive, true));
}

// User Preferences queries
export async function getUserPreferences(userId: number) {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db.select().from(userPreferences).where(eq(userPreferences.userId, userId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function createOrUpdateUserPreferences(userId: number, data: any) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await getUserPreferences(userId);
  if (existing) {
    await db.update(userPreferences).set(data).where(eq(userPreferences.userId, userId));
  } else {
    await db.insert(userPreferences).values({ userId, ...data });
  }
}

// Alerts queries
export async function createAlert(data: any): Promise<Alert> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(alerts).values(data).returning();
  return result[0];
}

export async function getAlertsByRecipient(recipientId: number) {
  const db = await getDb();
  if (!db) return [];

  return db.select().from(alerts).where(eq(alerts.recipientId, recipientId)).orderBy(desc(alerts.createdAt));
}

// Alert Logs queries
export async function createAlertLog(data: any): Promise<AlertLog> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(alertLogs).values(data).returning();
  return result[0];
}

// OTP Verification queries
function fallbackRecordToOtp(r: FallbackOtpRecord): OtpVerification {
  fallbackOtpIds.add(r.id);
  return {
    id: r.id,
    email: r.email,
    otp: r.otp,
    expiresAt: new Date(r.expiresAt),
    isUsed: r.isUsed,
    createdAt: new Date(r.createdAt),
  } as OtpVerification;
}

export async function createOtpVerification(email: string, otp: string, expirationMinutes = 10): Promise<OtpVerification> {
  // Normalize so a stray space or different letter-case never causes a
  // false "Invalid or expired OTP" at verification time.
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedOtp = otp.trim();
  const expiresAt = new Date(Date.now() + expirationMinutes * 60 * 1000);

  const db = await getDb();

  // Primary path: cloud Postgres (source of truth when reachable).
  if (db) {
    try {
      // Invalidate any previous un-used OTPs so only the most recent is valid.
      await db.update(otpVerifications)
        .set({ isUsed: true })
        .where(
          and(
            eq(otpVerifications.email, normalizedEmail),
            eq(otpVerifications.isUsed, false)
          )
        );

      const result = await db.insert(otpVerifications).values({
        email: normalizedEmail,
        otp: normalizedOtp,
        expiresAt,
      }).returning();

      if (result && result.length > 0) {
        console.log(`[Database] OTP persisted for ${normalizedEmail}, expires ${expiresAt.toISOString()}`);
        return result[0];
      }
      console.warn("[Database] OTP insert returned no rows; using local fallback store");
    } catch (error: any) {
      console.warn("[Database] OTP persist failed; using local fallback store:", error?.code || error?.message);
    }
  } else {
    console.warn("[Database] Unreachable; persisting OTP to local fallback store");
  }

  // Fallback path: local file-backed store so login still works.
  const rec = fallbackCreateOtp(normalizedEmail, normalizedOtp, expirationMinutes);
  return fallbackRecordToOtp(rec);
}

export async function getOtpVerification(email: string, otp: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedOtp = otp.trim();

  const db = await getDb();

  if (db) {
    try {
      const result = await db.select()
        .from(otpVerifications)
        .where(
          and(
            eq(otpVerifications.email, normalizedEmail),
            eq(otpVerifications.otp, normalizedOtp),
            eq(otpVerifications.isUsed, false),
            gte(otpVerifications.expiresAt, new Date())
          )
        )
        .limit(1);

      if (result.length > 0) {
        return result[0];
      }

      // No valid match in DB: log a precise reason (without leaking the OTP).
      const candidates = await db.select()
        .from(otpVerifications)
        .where(eq(otpVerifications.email, normalizedEmail))
        .orderBy(desc(otpVerifications.createdAt))
        .limit(1);

      if (candidates.length === 0) {
        console.warn(`[Database] OTP verify: no DB record for ${normalizedEmail}; checking fallback`);
      } else {
        const c = candidates[0];
        const reason =
          c.otp !== normalizedOtp ? "code mismatch"
          : c.isUsed ? "already used"
          : c.expiresAt < new Date() ? "expired"
          : "unknown";
        console.warn(`[Database] OTP verify failed for ${normalizedEmail}: ${reason}`);
        // A definitive DB record exists; do not fall through to the local store.
        return undefined;
      }
    } catch (error: any) {
      console.warn("[Database] OTP lookup failed; checking fallback store:", error?.code || error?.message);
    }
  } else {
    console.warn("[Database] Unreachable; checking local fallback OTP store");
  }

  // Fallback path.
  const rec = fallbackGetOtp(normalizedEmail, normalizedOtp);
  return rec ? fallbackRecordToOtp(rec) : undefined;
}

export async function markOtpAsUsed(id: number) {
  // If this id came from the local fallback store, update it there.
  if (fallbackOtpIds.has(id)) {
    fallbackMarkOtpUsed(id);
    return;
  }

  const db = await getDb();
  if (!db) {
    // Defensive: also attempt the fallback store in case of id ambiguity.
    fallbackMarkOtpUsed(id);
    return;
  }

  await db.update(otpVerifications)
    .set({ isUsed: true })
    .where(eq(otpVerifications.id, id));
}

export async function deleteExpiredOtps() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.delete(otpVerifications)
    .where(lte(otpVerifications.expiresAt, new Date()));
}
