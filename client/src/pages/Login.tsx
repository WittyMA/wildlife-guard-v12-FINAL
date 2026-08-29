import { useState } from "react";
import { useOtpLogin } from "@/_core/hooks/useOtpLogin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";

export default function LoginPage() {
  const {
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
  } = useOtpLogin();

  const [emailInput, setEmailInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [otpInput, setOtpInput] = useState("");

  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailInput.trim()) {
      return;
    }
    await requestOtp(emailInput.trim());
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpInput.trim()) {
      return;
    }
    await verifyOtp(otpInput.trim(), nameInput.trim() || undefined);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-2">
          <div className="flex items-center justify-center mb-4">
            <div className="w-12 h-12 bg-green-600 rounded-lg flex items-center justify-center">
              <span className="text-white text-xl font-bold">🦁</span>
            </div>
          </div>
          <CardTitle className="text-2xl text-center">Wildlife Conservation</CardTitle>
          <CardDescription className="text-center">
            {step === "email" ? "Sign in with your email" : "Enter the OTP code"}
          </CardDescription>
        </CardHeader>

        <CardContent>
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {message && (
            <Alert className="mb-4 border-green-200 bg-green-50">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <AlertDescription className="text-green-800">{message}</AlertDescription>
            </Alert>
          )}

          {step === "email" ? (
            <form onSubmit={handleRequestOtp} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="email" className="text-sm font-medium">
                  Email Address
                </label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  disabled={loading}
                  required
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="name" className="text-sm font-medium">
                  Full Name (Optional)
                </label>
                <Input
                  id="name"
                  type="text"
                  placeholder="John Doe"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  disabled={loading}
                />
              </div>

              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {loading ? "Sending OTP..." : "Send OTP"}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp} className="space-y-4">
              <div className="bg-blue-50 p-3 rounded-lg mb-4">
                <p className="text-sm text-gray-700">
                  OTP has been sent to <span className="font-semibold">{email}</span>
                </p>
              </div>

              <div className="space-y-2">
                <label htmlFor="otp" className="text-sm font-medium">
                  Enter OTP Code
                </label>
                <Input
                  id="otp"
                  type="text"
                  placeholder="000000"
                  value={otpInput}
                  onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  disabled={loading}
                  maxLength={6}
                  className="text-center text-2xl tracking-widest font-mono"
                  required
                />
                <p className="text-xs text-gray-500">OTP expires in 10 minutes</p>
              </div>

              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {loading ? "Verifying..." : "Verify OTP"}
              </Button>

              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={reset}
                disabled={loading}
              >
                Change Email
              </Button>
            </form>
          )}

          <div className="mt-6 pt-6 border-t text-center text-sm text-gray-500">
            <p>This is a secure authentication system</p>
            <p className="text-xs mt-2">Your data is protected and encrypted</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
