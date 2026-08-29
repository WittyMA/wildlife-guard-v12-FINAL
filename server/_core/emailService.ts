import nodemailer from "nodemailer";
import { ENV } from "./env";

let transporter: nodemailer.Transporter | null = null;

function getTransporter() {
  if (!transporter) {
    // Configure your email service here
    // Using Gmail example - you can change to any SMTP service
    transporter = nodemailer.createTransport({
      service: ENV.emailService || "gmail",
      auth: {
        user: ENV.emailUser,
        pass: ENV.emailPassword,
      },
    });
  }
  return transporter;
}

export async function sendOtpEmail(email: string, otp: string): Promise<boolean> {
  try {
    if (!ENV.emailUser || !ENV.emailPassword) {
      console.warn("[Email] Email credentials not configured. OTP not sent.");
      return false;
    }

    const transporter = getTransporter();

    const mailOptions = {
      from: ENV.emailUser,
      to: email,
      subject: "Wildlife Conservation PWA - Your OTP Code",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background-color: #2d5016; color: white; padding: 20px; text-align: center;">
            <h1>Wildlife Conservation System</h1>
          </div>
          <div style="padding: 30px; background-color: #f5f5f5;">
            <h2>Your One-Time Password (OTP)</h2>
            <p>You requested to sign in to the Wildlife Conservation PWA. Use the OTP below to verify your email:</p>
            <div style="background-color: white; border: 2px solid #2d5016; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0;">
              <h1 style="color: #2d5016; letter-spacing: 5px; margin: 0;">${otp}</h1>
            </div>
            <p style="color: #666;">This OTP will expire in 10 minutes.</p>
            <p style="color: #999; font-size: 12px;">If you did not request this code, please ignore this email.</p>
          </div>
          <div style="background-color: #2d5016; color: white; padding: 15px; text-align: center; font-size: 12px;">
            <p>&copy; 2026 Wildlife Conservation System. All rights reserved.</p>
          </div>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log(`[Email] OTP sent to ${email}`);
    return true;
  } catch (error) {
    console.error("[Email] Failed to send OTP:", error);
    return false;
  }
}

export async function sendWelcomeEmail(email: string, name: string): Promise<boolean> {
  try {
    if (!ENV.emailUser || !ENV.emailPassword) {
      console.warn("[Email] Email credentials not configured. Welcome email not sent.");
      return false;
    }

    const transporter = getTransporter();

    const mailOptions = {
      from: ENV.emailUser,
      to: email,
      subject: "Welcome to Wildlife Conservation PWA",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background-color: #2d5016; color: white; padding: 20px; text-align: center;">
            <h1>Wildlife Conservation System</h1>
          </div>
          <div style="padding: 30px; background-color: #f5f5f5;">
            <h2>Welcome, ${name || "User"}!</h2>
            <p>Thank you for signing up to the Wildlife Conservation PWA. You can now access the platform to monitor wildlife and manage conservation efforts.</p>
            <p>Start by exploring the dashboard to:</p>
            <ul>
              <li>Monitor camera stations</li>
              <li>Review detection events</li>
              <li>Manage drone missions</li>
              <li>Track ranger activities</li>
            </ul>
            <p>If you have any questions, please contact our support team.</p>
          </div>
          <div style="background-color: #2d5016; color: white; padding: 15px; text-align: center; font-size: 12px;">
            <p>&copy; 2026 Wildlife Conservation System. All rights reserved.</p>
          </div>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log(`[Email] Welcome email sent to ${email}`);
    return true;
  } catch (error) {
    console.error("[Email] Failed to send welcome email:", error);
    return false;
  }
}
