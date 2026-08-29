import { useState } from "react";
import axios from "axios";

export type OtpLoginStep = "email" | "otp";

export function useOtpLogin() {
  const [step, setStep] = useState<OtpLoginStep>("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const requestOtp = async (emailValue: string) => {
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const response = await axios.post("/api/auth/request-otp", {
        email: emailValue,
      });

      setEmail(emailValue);
      setStep("otp");
      setMessage(response.data.message || "OTP sent to your email");
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to request OTP");
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async (otpValue: string, nameValue?: string) => {
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const response = await axios.post("/api/auth/verify-otp", {
        email,
        otp: otpValue,
        name: nameValue || undefined,
      });

      setMessage(response.data.message || "Login successful");
      // Redirect after successful login
      setTimeout(() => {
        window.location.href = "/";
      }, 1000);
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to verify OTP");
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setStep("email");
    setEmail("");
    setOtp("");
    setName("");
    setError(null);
    setMessage(null);
  };

  return {
    step,
    email,
    otp,
    name,
    loading,
    error,
    message,
    setEmail,
    setOtp,
    setName,
    requestOtp,
    verifyOtp,
    reset,
  };
}
