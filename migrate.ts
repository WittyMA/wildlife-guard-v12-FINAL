import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '.env') });

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is not defined');
}

console.log('🚀 Starting migration...');

// Supavisor (pooler) often requires special handling for migrations.
// We use a single connection (max: 1) and ensure we're using the correct parameters.
const sql = postgres(connectionString, { 
  max: 1, 
  ssl: 'require',
  connect_timeout: 15,
  prepare: false, // Required for many poolers/proxies
});

const db = drizzle(sql);

async function main() {
  try {
    console.log('📦 Running migrations from ./drizzle folder...');
    
    await migrate(db, { 
      migrationsFolder: 'drizzle',
    });
    
    console.log('✅ Migration completed successfully!');
  } catch (error: any) {
    console.error('❌ Migration failed:');
    
    if (error.message?.includes('Tenant or user not found')) {
      console.error('🔑 Auth Error: "Tenant or user not found"');
      console.error('👉 This usually means the username/password in your DATABASE_URL is incorrect or not properly encoded.');
      console.log('\nYour current URL (masked):', connectionString.replace(/:([^:@]+)@/, ':****@'));
    } else if (error.code === 'ENETUNREACH') {
      console.error('🌐 Network Error: ENETUNREACH (IPv6 issue)');
      console.error('👉 Ensure you are using the Port 6543 connection string from Supabase.');
    } else {
      console.error(error);
    }
    process.exit(1);
  } finally {
    await sql.end();
  }
}

main();
