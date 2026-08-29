export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "your-secret-key-change-in-production",
  databaseUrl: process.env.DATABASE_URL ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  
  // Email OTP Configuration
  emailService: process.env.EMAIL_SERVICE ?? "gmail",
  emailUser: process.env.EMAIL_USER ?? "",
  emailPassword: process.env.EMAIL_PASSWORD ?? "",
};
