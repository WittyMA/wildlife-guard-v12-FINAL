import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getLoginUrl } from "@/const";
import { Link } from "wouter";
import { Camera, AlertCircle, Zap, Shield, MapPin, Rocket } from "lucide-react";

export default function Home() {
  const { user, isAuthenticated, logout } = useAuth();

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-green-50">
      {/* Header */}
      <header className="border-b bg-white/80 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Shield className="w-8 h-8 text-blue-600" />
            <h1 className="text-2xl font-bold">Wildlife Guard</h1>
          </div>
          <div className="flex items-center gap-4">
            {isAuthenticated ? (
              <>
                <span className="text-sm text-muted-foreground">{user?.name}</span>
                <Button variant="outline" onClick={() => logout()}>
                  Logout
                </Button>
              </>
            ) : (
              <Button asChild>
                <a href={getLoginUrl()}>Login</a>
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="max-w-6xl mx-auto px-4 py-16 md:py-24">
        <div className="text-center mb-12">
          <Badge className="mb-4 bg-blue-100 text-blue-800">Real-Time Protection</Badge>
          <h2 className="text-4xl md:text-5xl font-bold mb-4">
            Advanced Wildlife Protection System
          </h2>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Real-time AI-powered poaching detection with autonomous drone verification. Protect wildlife with cutting-edge technology.
          </p>
        </div>

        {/* Feature Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
          <Card>
            <CardHeader>
              <Camera className="w-8 h-8 text-blue-600 mb-2" />
              <CardTitle>Live Monitoring</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Real-time camera feeds with AI-powered detection. Motion-triggered inference for efficient processing.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <Zap className="w-8 h-8 text-yellow-600 mb-2" />
              <CardTitle>Instant Alerts</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Critical detections trigger immediate notifications to ranger devices with GPS coordinates.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <Rocket className="w-8 h-8 text-red-600 mb-2" />
              <CardTitle>Drone Deployment</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Autonomous drone verification of critical detections for rapid response and evidence gathering.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <AlertCircle className="w-8 h-8 text-orange-600 mb-2" />
              <CardTitle>Offline-First</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Works offline with automatic sync when connectivity is restored. No data loss.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <MapPin className="w-8 h-8 text-green-600 mb-2" />
              <CardTitle>GPS Tracking</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Precise location tracking for all detections and drone missions with geofencing support.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <Shield className="w-8 h-8 text-purple-600 mb-2" />
              <CardTitle>Admin Panel</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Comprehensive admin interface for detection review, verification, and reporting.
              </p>
            </CardContent>
          </Card>
        </div>

        {/* CTA Section */}
        {isAuthenticated ? (
          <div className="bg-white rounded-lg border p-8 text-center">
            <h3 className="text-2xl font-bold mb-6">Get Started</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Link href="/monitor">
                <Button className="w-full" size="lg">
                  <Camera className="w-4 h-4 mr-2" />
                  Start Monitoring
                </Button>
              </Link>
              <Link href="/detections">
                <Button variant="outline" className="w-full" size="lg">
                  <AlertCircle className="w-4 h-4 mr-2" />
                  View Detections
                </Button>
              </Link>
              <Link href="/ranger-alerts">
                <Button variant="outline" className="w-full" size="lg">
                  <Rocket className="w-4 h-4 mr-2" />
                  Ranger Alerts
                </Button>
              </Link>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-lg border p-8 text-center">
            <h3 className="text-2xl font-bold mb-4">Ready to Protect Wildlife?</h3>
            <p className="text-muted-foreground mb-6">
              Sign in to access the Wildlife Guard monitoring system
            </p>
            <Button asChild size="lg">
              <a href={getLoginUrl()}>Sign In Now</a>
            </Button>
          </div>
        )}
      </section>

      {/* Footer */}
      <footer className="border-t bg-white/50 backdrop-blur mt-16">
        <div className="max-w-6xl mx-auto px-4 py-8 text-center text-sm text-muted-foreground">
          <p>Wildlife Guard © 2026. Advanced Conservation Technology.</p>
        </div>
      </footer>
    </div>
  );
}
