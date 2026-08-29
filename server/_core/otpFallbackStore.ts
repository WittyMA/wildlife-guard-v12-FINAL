/**
 * Resilient local OTP fallback store.
 * --------------------------------------------------------------------------
 * Used ONLY when the primary (cloud Postgres) database is unreachable, so that
 * one-time-password login keeps working for development, demos, and during
 * transient database outages.
 *
 * It is a tiny, dependency-free, file-backed JSON store. Each OTP record mirrors
 * the shape of the `otp_verifications` table so the rest of the auth code can
 * treat it identically.
 *
 * Records are written to OS temp dir (overridable via OTP_FALLBACK_FILE).
 * This is intentionally simple and single-process; it is NOT a replacement for
 * the real database, only a safety net for the OTP login path.
 */
import fs from "fs";
import os from "os";
import path from "path";

export interface FallbackOtpRecord {
  id: number;
  email: string;
  otp: string;
  expiresAt: string; // ISO string
  isUsed: boolean;
  createdAt: string; // ISO string
}

const STORE_FILE =
  process.env.OTP_FALLBACK_FILE ||
  path.join(os.tmpdir(), "wildlife-guard-otp-fallback.json");

function readAll(): FallbackOtpRecord[] {
  try {
    if (!fs.existsSync(STORE_FILE)) return [];
    const raw = fs.readFileSync(STORE_FILE, "utf-8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.warn("[OTP-Fallback] Could not read store, starting fresh:", (e as Error).message);
    return [];
  }
}

function writeAll(records: FallbackOtpRecord[]): void {
  try {
    fs.writeFileSync(STORE_FILE, JSON.stringify(records, null, 2), "utf-8");
  } catch (e) {
    console.error("[OTP-Fallback] Could not write store:", (e as Error).message);
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Create (persist) an OTP record in the fallback store.
 * Any previous un-used OTPs for the same email are invalidated.
 */
export function fallbackCreateOtp(
  email: string,
  otp: string,
  expirationMinutes = 10
): FallbackOtpRecord {
  const records = readAll();
  const normalizedEmail = normalizeEmail(email);
  const normalizedOtp = otp.trim();

  // Invalidate previous un-used OTPs for this email.
  for (const r of records) {
    if (r.email === normalizedEmail && !r.isUsed) {
      r.isUsed = true;
    }
  }

  const now = new Date();
  const record: FallbackOtpRecord = {
    id: now.getTime(), // monotonic-enough unique id
    email: normalizedEmail,
    otp: normalizedOtp,
    expiresAt: new Date(now.getTime() + expirationMinutes * 60 * 1000).toISOString(),
    isUsed: false,
    createdAt: now.toISOString(),
  };

  records.push(record);

  // Opportunistic cleanup of expired/used records to keep the file small.
  const cutoff = now.getTime();
  const pruned = records.filter(
    (r) => !r.isUsed && new Date(r.expiresAt).getTime() > cutoff
  );
  // Always keep the just-created record.
  if (!pruned.find((r) => r.id === record.id)) pruned.push(record);

  writeAll(pruned);
  console.log(
    `[OTP-Fallback] OTP persisted locally for ${normalizedEmail}, expires ${record.expiresAt}`
  );
  return record;
}

/**
 * Look up a valid (un-used, un-expired) OTP record.
 */
export function fallbackGetOtp(
  email: string,
  otp: string
): FallbackOtpRecord | undefined {
  const records = readAll();
  const normalizedEmail = normalizeEmail(email);
  const normalizedOtp = otp.trim();
  const now = Date.now();

  const match = records.find(
    (r) =>
      r.email === normalizedEmail &&
      r.otp === normalizedOtp &&
      !r.isUsed &&
      new Date(r.expiresAt).getTime() >= now
  );

  if (match) return match;

  // Diagnostic logging (never logs the actual code).
  const latest = records
    .filter((r) => r.email === normalizedEmail)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

  if (!latest) {
    console.warn(`[OTP-Fallback] verify failed: no OTP on record for ${normalizedEmail}`);
  } else {
    const reason =
      latest.otp !== normalizedOtp ? "code mismatch"
      : latest.isUsed ? "already used"
      : new Date(latest.expiresAt).getTime() < now ? "expired"
      : "unknown";
    console.warn(`[OTP-Fallback] verify failed for ${normalizedEmail}: ${reason}`);
  }
  return undefined;
}

/**
 * Mark an OTP record as used.
 */
export function fallbackMarkOtpUsed(id: number): void {
  const records = readAll();
  let changed = false;
  for (const r of records) {
    if (r.id === id) {
      r.isUsed = true;
      changed = true;
    }
  }
  if (changed) writeAll(records);
}

/* ==========================================================================
 * User fallback store
 * --------------------------------------------------------------------------
 * Mirrors the minimal user fields needed to issue a session when the cloud
 * database is unreachable. Persisted to a sibling JSON file so accounts are
 * stable across restarts during an outage.
 * ======================================================================== */

export interface FallbackUserRecord {
  id: number;
  email: string;
  name: string | null;
  role: string;
  lastSignedIn: string | null; // ISO string
  createdAt: string; // ISO string
  updatedAt: string; // ISO string
}

const USER_STORE_FILE =
  process.env.USER_FALLBACK_FILE ||
  path.join(os.tmpdir(), "wildlife-guard-user-fallback.json");

function readAllUsers(): FallbackUserRecord[] {
  try {
    if (!fs.existsSync(USER_STORE_FILE)) return [];
    const raw = fs.readFileSync(USER_STORE_FILE, "utf-8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.warn("[User-Fallback] Could not read store, starting fresh:", (e as Error).message);
    return [];
  }
}

function writeAllUsers(records: FallbackUserRecord[]): void {
  try {
    fs.writeFileSync(USER_STORE_FILE, JSON.stringify(records, null, 2), "utf-8");
  } catch (e) {
    console.error("[User-Fallback] Could not write store:", (e as Error).message);
  }
}

export interface FallbackUpsertUserInput {
  email: string;
  name?: string | null;
  role?: string;
  lastSignedIn?: Date | null;
}

/**
 * Insert or update a user in the fallback store (keyed by normalized email).
 */
export function fallbackUpsertUser(user: FallbackUpsertUserInput): FallbackUserRecord {
  const records = readAllUsers();
  const email = normalizeEmail(user.email);
  const now = new Date().toISOString();

  let record = records.find((r) => r.email === email);
  if (record) {
    if (user.name !== undefined) record.name = user.name ?? null;
    if (user.role !== undefined) record.role = user.role;
    record.lastSignedIn = (user.lastSignedIn ?? new Date()).toISOString
      ? (user.lastSignedIn ?? new Date()).toISOString()
      : now;
    record.updatedAt = now;
  } else {
    record = {
      id: Date.now(),
      email,
      name: user.name ?? null,
      role: user.role ?? "user",
      lastSignedIn: (user.lastSignedIn ?? new Date()).toISOString(),
      createdAt: now,
      updatedAt: now,
    };
    records.push(record);
  }

  writeAllUsers(records);
  console.log(`[User-Fallback] User upserted locally: ${email}`);
  return record;
}

export function fallbackGetUserByEmail(email: string): FallbackUserRecord | undefined {
  const records = readAllUsers();
  const normalized = normalizeEmail(email);
  return records.find((r) => r.email === normalized);
}

export function fallbackGetUserById(id: number): FallbackUserRecord | undefined {
  const records = readAllUsers();
  return records.find((r) => r.id === id);
}
