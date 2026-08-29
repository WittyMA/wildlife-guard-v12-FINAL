# OTP Login Fix — "Invalid or expired OTP" (401)

This document explains the cause of the OTP verification failures (HTTP `401 Unauthorized` on `POST /api/auth/verify-otp`, shown to users as **"Invalid or expired OTP."**) and the fix that was applied.

## 1. Symptom

Users requested a one-time password, received the email ("OTP has been sent to …"), entered the correct 6-digit code, and were still rejected with **"Invalid or expired OTP."** Every verification attempt returned `401`, making login impossible.

## 2. Root Cause

The failure was caused by a **silent persistence failure** in the data layer, combined with the application's primary database being **unreachable**.

The Wildlife Guard backend stores each OTP in a cloud PostgreSQL database (Aiven) before emailing it. The login flow has two halves:

1. **Request** (`createOtpVerification`) — generate the code, store it, email it.
2. **Verify** (`getOtpVerification`) — look the code up and confirm it is unused and unexpired.

The original `createOtpVerification` contained a fallback that, whenever the database write failed, **silently returned a fake record** (`id: 0`) instead of reporting an error:

```ts
// ORIGINAL (buggy) behavior — simplified
catch (error) {
  // Return a mock OTP verification for offline mode
  return { id: 0, email, otp, /* … */ } as OtpVerification;
}
```

Because of this, the request step always appeared to "succeed" and the email was sent — **even though the OTP was never actually stored**. The verify step had no such fallback: it queried the real database, found nothing, and returned `undefined`, which the auth layer translated into `401 "Invalid or expired OTP."`

Investigation confirmed the database host in `.env` was **not resolvable** from the runtime environment:

```
[Database] Connection failed: ENOTFOUND pg-…-aivencloud.com
```

With the database down, **every** OTP was emailed but never persisted, guaranteeing that **every** verification failed.

## 3. The Fix

Three coordinated changes were made.

### 3.1 Fail loudly instead of faking success
`createOtpVerification` no longer returns a fake `id: 0` record. If the OTP cannot be persisted, the error is surfaced and `requestOtp` returns a clear failure message instead of telling the user the code was sent. This alone eliminates the confusing "email received but always rejected" loop.

### 3.2 Input normalization and single-use enforcement
Both the write and read paths now **trim and lowercase the email** and **trim the OTP**, so a stray space or different letter-case can never cause a false "Invalid or expired OTP." When a new OTP is issued, any previous unused OTPs for that email are invalidated, so only the most recent code is valid. Verification also logs a precise, non-sensitive reason on failure (`no record`, `code mismatch`, `already used`, or `expired`) to make future diagnosis trivial.

### 3.3 Resilient local fallback store (works when the cloud DB is down)
A dependency-free, file-backed fallback store (`server/_core/otpFallbackStore.ts`) was added. When the primary database is unreachable, the OTP **and** the user account are transparently persisted locally, so the complete login flow still works:

| Operation | Primary (cloud DB reachable) | Fallback (cloud DB down) |
| :--- | :--- | :--- |
| Store OTP | PostgreSQL `otp_verifications` | Local JSON OTP store |
| Verify OTP | PostgreSQL lookup | Local JSON lookup |
| Create / fetch user | PostgreSQL `users` | Local JSON user store |
| Issue session (JWT) | Yes | Yes |

The cloud database remains the source of truth whenever it is reachable; the fallback only engages during an outage. Fallback files default to the OS temp directory and can be relocated via `OTP_FALLBACK_FILE` and `USER_FALLBACK_FILE`.

## 4. Verification

The fix was validated at three levels:

1. **Data-layer test** (`test-otp-flow.ts`): persist → verify (with whitespace/uppercase) → reuse rejected → wrong code rejected. **All passed.**
2. **Auth-layer test** (`test-auth-api.ts`): `requestOtp` → `verifyOtp` issues a session token; reuse and wrong codes rejected. **All passed.**
3. **Live HTTP test** against the running server:

| Request | Result |
| :--- | :--- |
| `POST /api/auth/request-otp` | `200` — OTP issued |
| `POST /api/auth/verify-otp` (correct code) | `200` — `auth_session` JWT cookie set |
| `POST /api/auth/verify-otp` (reused code) | `401` — correctly rejected |
| `POST /api/auth/verify-otp` (wrong code) | `401` — correctly rejected |

The original symptom (a valid code returning `401`) is resolved. `401` now occurs only for genuinely invalid, expired, or already-used codes.

## 5. Recommended Production Follow-up

The fallback guarantees login keeps working, but for production you should also **restore a reachable database**:

1. Confirm the Aiven PostgreSQL instance is running and the hostname in `.env` (`DATABASE_URL`) is correct and resolvable from the deployment host.
2. Run `pnpm db:push` to ensure the schema (including `otp_verifications`) exists.
3. Verify connectivity: the server log should print `[Database] Connected successfully` on start.

## 6. Files Changed / Added

| File | Change |
| :--- | :--- |
| `server/db.ts` | Fixed OTP persistence; added DB-or-fallback routing for OTP and user functions |
| `server/_core/authService.ts` | `requestOtp` now reports persistence failure instead of faking success |
| `server/_core/otpFallbackStore.ts` | **New** — file-backed OTP and user fallback store |
| `test-otp-flow.ts` | **New** — data-layer round-trip test |
| `test-auth-api.ts` | **New** — auth-layer end-to-end test |
