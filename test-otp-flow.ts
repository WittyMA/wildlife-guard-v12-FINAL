/**
 * Standalone OTP round-trip test.
 * Verifies the persist -> verify cycle works against the configured database,
 * and that whitespace / case normalization behaves as expected.
 *
 * Run: npx tsx test-otp-flow.ts
 */
import "dotenv/config";
import {
  createOtpVerification,
  getOtpVerification,
  markOtpAsUsed,
  getDb,
  closeDb,
} from "./server/db";

async function main() {
  const email = `test-${Date.now()}@example.com`;
  const otp = "123456";

  console.log("1) Checking database connectivity...");
  const db = await getDb();
  if (!db) {
    console.warn("   WARN: cloud database not reachable - exercising LOCAL FALLBACK path.");
  } else {
    console.log("   OK: cloud database connected (primary path).");
  }

  console.log("2) Creating OTP...");
  const created = await createOtpVerification(email, otp, 10);
  console.log(`   OK: stored OTP id=${created.id} for ${created.email}`);

  console.log("3) Verifying correct OTP (with surrounding whitespace + uppercase email)...");
  const found = await getOtpVerification(`  ${email.toUpperCase()} `, ` ${otp} `);
  if (!found) {
    console.error("   FAIL: valid OTP was not found.");
    process.exit(1);
  }
  console.log(`   OK: OTP matched (id=${found.id}).`);

  console.log("4) Marking OTP as used...");
  await markOtpAsUsed(found.id);
  const reused = await getOtpVerification(email, otp);
  if (reused) {
    console.error("   FAIL: used OTP should not verify again.");
    process.exit(1);
  }
  console.log("   OK: used OTP correctly rejected.");

  console.log("5) Verifying wrong OTP is rejected...");
  const wrong = await getOtpVerification(email, "000000");
  if (wrong) {
    console.error("   FAIL: wrong OTP should not verify.");
    process.exit(1);
  }
  console.log("   OK: wrong OTP correctly rejected.");

  console.log("\nALL OTP TESTS PASSED ✅");
  await closeDb();
  process.exit(0);
}

main().catch(async (e) => {
  console.error("TEST ERROR:", e);
  await closeDb();
  process.exit(1);
});
