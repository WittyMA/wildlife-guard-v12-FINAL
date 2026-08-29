import { defineConfig } from "drizzle-kit";
import * as dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from the root directory
dotenv.config({ path: path.resolve(__dirname, ".env") });

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error("❌ DATABASE_URL is not defined in .env file");
} else {
  // Mask password for logging
  const masked = connectionString.replace(/:([^:@]+)@/, ":****@");
  console.log(`📡 Using database URL: ${masked}`);
}

export default defineConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: connectionString!,
  },
  verbose: true,
  strict: true,
});
