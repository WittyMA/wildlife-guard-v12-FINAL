import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Settings as SettingsIcon, Save, Loader2 } from 'lucide-react';
import { useAuth } from '@/_core/hooks/useAuth';
import { trpc } from '@/lib/trpc';

export default function Settings() {
  const { user } = useAuth();
  const [isSaving, setIsSaving] = useState(false);

  // Detection settings
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.85);
  const [motionSensitivity, setMotionSensitivity] = useState<'low' | 'medium' | 'high'>('medium');

  // Drone settings
  const [droneCruiseSpeed, setDroneCruiseSpeed] = useState(15);
  const [droneMaxAltitude, setDroneMaxAltitude] = useState(400);
  const [droneGeofenceRadius, setDroneGeofenceRadius] = useState(5000);

  // Offline sync settings
  const [offlineSyncRetryInterval, setOfflineSyncRetryInterval] = useState(30);
  const [offlineSyncMaxQueueSize, setOfflineSyncMaxQueueSize] = useState(1000);

  // Notification settings
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // Save preferences to server
      console.log('Saving settings:', {
        confidenceThreshold,
        motionSensitivity,
        droneCruiseSpeed,
        droneMaxAltitude,
        droneGeofenceRadius,
        offlineSyncRetryInterval,
        offlineSyncMaxQueueSize,
        notificationsEnabled,
      });

      // In a real app, this would call a tRPC mutation
      alert('Settings saved successfully');
    } catch (error) {
      console.error('Failed to save settings:', error);
      alert('Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <SettingsIcon className="w-8 h-8" />
              Settings
            </h1>
            <p className="text-muted-foreground">Customize your Wildlife Guard experience</p>
          </div>
          <div className="text-right">
            <div className="text-sm text-muted-foreground">Logged in as</div>
            <div className="font-semibold">{user?.name}</div>
          </div>
        </div>

        {/* Detection Settings */}
        <Card>
          <CardHeader>
            <CardTitle>Detection Settings</CardTitle>
            <CardDescription>Configure AI detection parameters</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <div className="flex justify-between mb-2">
                <label className="text-sm font-medium">Confidence Threshold</label>
                <Badge variant="outline">{(confidenceThreshold * 100).toFixed(0)}%</Badge>
              </div>
              <Slider
                value={[confidenceThreshold]}
                onValueChange={(value) => setConfidenceThreshold(value[0])}
                min={0.5}
                max={1}
                step={0.05}
                className="w-full"
              />
              <p className="text-xs text-muted-foreground mt-2">
                Detections below this confidence will not trigger alerts
              </p>
            </div>

            <div>
              <label className="text-sm font-medium mb-3 block">Motion Detection Sensitivity</label>
              <div className="flex gap-2">
                {(['low', 'medium', 'high'] as const).map((level) => (
                  <Button
                    key={level}
                    variant={motionSensitivity === level ? 'default' : 'outline'}
                    onClick={() => setMotionSensitivity(level)}
                    className="flex-1 capitalize"
                  >
                    {level}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Higher sensitivity detects more motion but may increase false positives
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Drone Settings */}
        <Card>
          <CardHeader>
            <CardTitle>Drone Configuration</CardTitle>
            <CardDescription>Configure autonomous drone parameters</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <div className="flex justify-between mb-2">
                <label className="text-sm font-medium">Cruise Speed</label>
                <Badge variant="outline">{droneCruiseSpeed} m/s</Badge>
              </div>
              <Slider
                value={[droneCruiseSpeed]}
                onValueChange={(value) => setDroneCruiseSpeed(value[0])}
                min={5}
                max={30}
                step={1}
                className="w-full"
              />
              <p className="text-xs text-muted-foreground mt-2">
                Default cruise speed for drone missions
              </p>
            </div>

            <div>
              <div className="flex justify-between mb-2">
                <label className="text-sm font-medium">Maximum Altitude</label>
                <Badge variant="outline">{droneMaxAltitude} m</Badge>
              </div>
              <Slider
                value={[droneMaxAltitude]}
                onValueChange={(value) => setDroneMaxAltitude(value[0])}
                min={100}
                max={500}
                step={10}
                className="w-full"
              />
              <p className="text-xs text-muted-foreground mt-2">
                Maximum altitude for drone operations
              </p>
            </div>

            <div>
              <div className="flex justify-between mb-2">
                <label className="text-sm font-medium">Geofence Radius</label>
                <Badge variant="outline">{droneGeofenceRadius} m</Badge>
              </div>
              <Slider
                value={[droneGeofenceRadius]}
                onValueChange={(value) => setDroneGeofenceRadius(value[0])}
                min={1000}
                max={10000}
                step={500}
                className="w-full"
              />
              <p className="text-xs text-muted-foreground mt-2">
                Geofence boundary for drone operations
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Offline Sync Settings */}
        <Card>
          <CardHeader>
            <CardTitle>Offline Sync</CardTitle>
            <CardDescription>Configure offline-first synchronization</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <div className="flex justify-between mb-2">
                <label className="text-sm font-medium">Retry Interval</label>
                <Badge variant="outline">{offlineSyncRetryInterval}s</Badge>
              </div>
              <Slider
                value={[offlineSyncRetryInterval]}
                onValueChange={(value) => setOfflineSyncRetryInterval(value[0])}
                min={10}
                max={120}
                step={5}
                className="w-full"
              />
              <p className="text-xs text-muted-foreground mt-2">
                Time between sync attempts when offline
              </p>
            </div>

            <div>
              <div className="flex justify-between mb-2">
                <label className="text-sm font-medium">Max Queue Size</label>
                <Badge variant="outline">{offlineSyncMaxQueueSize}</Badge>
              </div>
              <Slider
                value={[offlineSyncMaxQueueSize]}
                onValueChange={(value) => setOfflineSyncMaxQueueSize(value[0])}
                min={100}
                max={5000}
                step={100}
                className="w-full"
              />
              <p className="text-xs text-muted-foreground mt-2">
                Maximum number of items to queue for sync
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Notification Settings */}
        <Card>
          <CardHeader>
            <CardTitle>Notifications</CardTitle>
            <CardDescription>Configure notification preferences</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-medium">Enable Notifications</label>
                <p className="text-xs text-muted-foreground">
                  Receive push notifications for critical detections
                </p>
              </div>
              <Switch
                checked={notificationsEnabled}
                onCheckedChange={setNotificationsEnabled}
              />
            </div>
          </CardContent>
        </Card>

        {/* Save Button */}
        <div className="flex gap-2">
          <Button
            onClick={handleSave}
            disabled={isSaving}
            size="lg"
            className="flex-1"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="w-4 h-4 mr-2" />
                Save Settings
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
