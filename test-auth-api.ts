/**
 * End-to-end auth-layer test for the OTP login flow.
 * Drives the real authService (request -> verify) the same way the HTTP routes do.
 *
 * Because email delivery may be blocked in CI/sandbox, we capture the generated
 * OTP directly from the persistence layer (DB or fallback) to simulate the user
 * typing the code they received by email.
 *
 * Run: npx tsx test-auth-api.ts
 */
import "dotenv/config";
import { authService } from "./server/_core/authService";
import { getOtpVerification, closeDb } from "./server/db";

// Brute-force is not needed; we read the persisted code via a known email by
// trying the same generator space is infeasible, so instead we re-query using a
// helper that returns the latest record for the email. We reuse getOtpVerification
// by scanning, but the simplest reliable approach is to read the fallback file or
// DB row. Here we expose the code through a tiny re-request + capture pattern:
import { fallbackGetOtp } from "./server/_core/otpFallbackStore";
import fs from "fs";
import os from "os";
import path from "path";

function readLatestFallbackOtp(email: string): string | undefined {
  const file =
    process.env.OTP_FALLBACK_FILE ||
    path.join(os.tmpdir(), "wildlife-guard-otp-fallback.json");
  if (!fs.existsSync(file)) return undefined;
  const records = JSON.parse(fs.readFileSync(file, "utf-8")) as Array<{
    email: string; otp: string; isUsed: boolean; createdAt: string;
  }>;
  const latest = records
    .filter((r) => r.email === email.toLowerCase() && !r.isUsed)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  return latest?.otp;
}

async function main() {
  const email = `apitest-${Date.now()}@example.com`;

  console.log("STEP 1: requestOtp()");
  const req = await authService.requestOtp(email);
  console.log("   result:", req);
  // Email may fail in sandbox; that's fine as long as the OTP was persisted.

  console.log("STEP 2: retrieve the persisted OTP (simulating the emailed code)");
  const code = readLatestFallbackOtp(email);
  if (!code) {
    console.error("   FAIL: could not locate a persisted OTP for the email.");
    await closeDb();
    process.exit(1);
  }
  console.log(`   located OTP: ${code}`);

  console.log("STEP 3: verifyOtp() with the correct code");
  const verify = await authService.verifyOtp(email, code, "API Test User");
  console.log("   result:", { success: verify.success, message: verify.message, hasToken: !!verify.sessionToken });
  if (!verify.success || !verify.sessionToken) {
    console.error("   FAIL: verification should have succeeded.");
    await closeDb();
    process.exit(1);
  }

  console.log("STEP 4: verifyOtp() again with the same code (should now fail - single use)");
  const reuse = await authService.verifyOtp(email, code);
  console.log("   result:", { success: reuse.success, message: reuse.message });
  if (reuse.success) {
    console.error("   FAIL: reused OTP should be rejected.");
    await closeDb();
    process.exit(1);
  }

  console.log("STEP 5: verifyOtp() with a wrong code (should fail)");
  const wrong = await authService.verifyOtp(email, "000000");
  console.log("   result:", { success: wrong.success, message: wrong.message });
  if (wrong.success) {
    console.error("   FAIL: wrong OTP should be rejected.");
    await closeDb();
    process.exit(1);
  }

  console.log("\nAUTH API FLOW TEST PASSED ✅  (request -> verify -> session issued; reuse & wrong code rejected)");
  await closeDb();
  process.exit(0);
}

main().catch(async (e) => {
  console.error("TEST ERROR:", e);
  await closeDb();
  process.exit(1);
});
