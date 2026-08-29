import { SignJWT, jwtVerify } from "jose";
import type { Request } from "express";
import { parse as parseCookieHeader } from "cookie";
import type { User } from "../../drizzle/schema";
import * as db from "../db";
import { ENV } from "./env";
import { sendOtpEmail, sendWelcomeEmail } from "./emailService";
import { ForbiddenError } from "@shared/_core/errors";

const COOKIE_NAME = "auth_session";
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export type SessionPayload = {
  userId: number;
  email: string;
};

function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

class AuthService {
  private getSessionSecret() {
    const secret = ENV.cookieSecret;
    return new TextEncoder().encode(secret);
  }

  private parseCookies(cookieHeader: string | undefined) {
    if (!cookieHeader) {
      return new Map<string, string>();
    }

    const parsed = parseCookieHeader(cookieHeader);
    return new Map(Object.entries(parsed));
  }

  /**
   * Request OTP for email
   */
  async requestOtp(email: string): Promise<{ success: boolean; message: string }> {
    try {
      const otp = generateOtp();

      // Persist FIRST. If this throws, the OTP was never stored and we must
      // not tell the user it was sent (otherwise verification always fails).
      try {
        await db.createOtpVerification(email, otp, 10); // 10 minutes expiry
      } catch (persistError) {
        console.error("[Auth] Failed to persist OTP:", persistError);
        return {
          success: false,
          message: "Could not generate OTP at this time. Please try again shortly.",
        };
      }

      const emailSent = await sendOtpEmail(email, otp);

      if (!emailSent) {
        return {
          success: false,
          message: "Failed to send OTP email. Please check email configuration.",
        };
      }

      return {
        success: true,
        message: "OTP sent to your email. Valid for 10 minutes.",
      };
    } catch (error) {
      console.error("[Auth] Failed to request OTP:", error);
      return {
        success: false,
        message: "Failed to request OTP. Please try again.",
      };
    }
  }

  /**
   * Verify OTP and create session
   */
  async verifyOtp(
    email: string,
    otp: string,
    name?: string
  ): Promise<{ success: boolean; message: string; sessionToken?: string }> {
    try {
      // Verify OTP exists and is not expired
      const otpRecord = await db.getOtpVerification(email, otp);

      if (!otpRecord) {
        return {
          success: false,
          message: "Invalid or expired OTP.",
        };
      }

      // Mark OTP as used
      await db.markOtpAsUsed(otpRecord.id);

      // Upsert user
      let user = await db.getUserByEmail(email);
      if (!user) {
        await db.upsertUser({
          email,
          name: name || null,
          role: "user",
          lastSignedIn: new Date(),
        });
        user = await db.getUserByEmail(email);

        // Send welcome email for new users
        if (user) {
          await sendWelcomeEmail(email, name || "");
        }
      } else {
        // Update last signed in for existing users
        await db.upsertUser({
          email,
          lastSignedIn: new Date(),
        });
      }

      if (!user) {
        return {
          success: false,
          message: "Failed to create or retrieve user.",
        };
      }

      // Create session token
      const sessionToken = await this.createSessionToken(user.id, user.email);

      return {
        success: true,
        message: "OTP verified successfully.",
        sessionToken,
      };
    } catch (error) {
      console.error("[Auth] Failed to verify OTP:", error);
      return {
        success: false,
        message: "Failed to verify OTP. Please try again.",
      };
    }
  }

  /**
   * Create a session token
   */
  async createSessionToken(userId: number, email: string): Promise<string> {
    return this.signSession(
      {
        userId,
        email,
      },
      { expiresInMs: ONE_YEAR_MS }
    );
  }

  /**
   * Sign session JWT
   */
  async signSession(
    payload: SessionPayload,
    options: { expiresInMs?: number } = {}
  ): Promise<string> {
    const issuedAt = Date.now();
    const expiresInMs = options.expiresInMs ?? ONE_YEAR_MS;
    const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1000);
    const secretKey = this.getSessionSecret();

    return new SignJWT({
      userId: payload.userId,
      email: payload.email,
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setExpirationTime(expirationSeconds)
      .sign(secretKey);
  }

  /**
   * Verify session token
   */
  async verifySession(
    cookieValue: string | undefined | null
  ): Promise<{ userId: number; email: string } | null> {
    if (!cookieValue) {
      console.warn("[Auth] Missing session cookie");
      return null;
    }

    try {
      const secretKey = this.getSessionSecret();
      const { payload } = await jwtVerify(cookieValue, secretKey, {
        algorithms: ["HS256"],
      });

      const { userId, email } = payload as Record<string, unknown>;

      if (typeof userId !== "number" || typeof email !== "string") {
        console.warn("[Auth] Session payload missing required fields");
        return null;
      }

      return { userId, email };
    } catch (error) {
      console.warn("[Auth] Session verification failed", String(error));
      return null;
    }
  }

  /**
   * Authenticate request and return user
   */
  async authenticateRequest(req: Request): Promise<User> {
    const cookies = this.parseCookies(req.headers.cookie);
    const sessionCookie = cookies.get(COOKIE_NAME);
    const session = await this.verifySession(sessionCookie);

    if (!session) {
      throw ForbiddenError("Invalid or missing session");
    }

    const user = await db.getUserById(session.userId);

    if (!user) {
      throw ForbiddenError("User not found");
    }

    // Update last signed in
    await db.upsertUser({
      email: user.email,
      lastSignedIn: new Date(),
    });

    return user;
  }

  /**
   * Get cookie name
   */
  getCookieName(): string {
    return COOKIE_NAME;
  }

  /**
   * Get session expiry time
   */
  getSessionExpiry(): number {
    return ONE_YEAR_MS;
  }
}

export const authService = new AuthService();
