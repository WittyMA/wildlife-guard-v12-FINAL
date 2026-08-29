import type { Express, Request, Response } from "express";
import { authService } from "./authService";
import { getSessionCookieOptions } from "./cookies";

export function registerAuthRoutes(app: Express) {
  /**
   * Request OTP endpoint
   * POST /api/auth/request-otp
   * Body: { email: string }
   */
  app.post("/api/auth/request-otp", async (req: Request, res: Response) => {
    try {
      const { email } = req.body;

      if (!email || typeof email !== "string") {
        res.status(400).json({ error: "Email is required" });
        return;
      }

      // Basic email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        res.status(400).json({ error: "Invalid email format" });
        return;
      }

      const result = await authService.requestOtp(email);

      if (!result.success) {
        res.status(500).json({ error: result.message });
        return;
      }

      res.json({ success: true, message: result.message });
    } catch (error) {
      console.error("[Auth] Request OTP failed:", error);
      res.status(500).json({ error: "Failed to request OTP" });
    }
  });

  /**
   * Verify OTP endpoint
   * POST /api/auth/verify-otp
   * Body: { email: string, otp: string, name?: string }
   */
  app.post("/api/auth/verify-otp", async (req: Request, res: Response) => {
    try {
      const { email, otp, name } = req.body;

      if (!email || !otp) {
        res.status(400).json({ error: "Email and OTP are required" });
        return;
      }

      const result = await authService.verifyOtp(email, otp, name);

      if (!result.success) {
        res.status(401).json({ error: result.message });
        return;
      }

      // Set session cookie
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(authService.getCookieName(), result.sessionToken, {
        ...cookieOptions,
        maxAge: authService.getSessionExpiry(),
      });

      res.json({ success: true, message: result.message });
    } catch (error) {
      console.error("[Auth] Verify OTP failed:", error);
      res.status(500).json({ error: "Failed to verify OTP" });
    }
  });

  /**
   * Logout endpoint
   * POST /api/auth/logout
   */
  app.post("/api/auth/logout", (req: Request, res: Response) => {
    try {
      res.clearCookie(authService.getCookieName());
      res.json({ success: true, message: "Logged out successfully" });
    } catch (error) {
      console.error("[Auth] Logout failed:", error);
      res.status(500).json({ error: "Failed to logout" });
    }
  });
}
