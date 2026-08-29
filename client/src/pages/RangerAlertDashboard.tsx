import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertCircle, Loader2, MapPin, Rocket, CheckCircle, XCircle } from 'lucide-react';
import { trpc } from '@/lib/trpc';

interface CriticalDetection {
  id: string;
  type: 'human' | 'animal' | 'vehicle' | 'anonymous' | 'dark_environment' | 'blurry_image';
  confidence: number;
  timestamp: number;
  stationId: string;
  latitude?: number;
  longitude?: number;
  imageUrl?: string;
}

export default function RangerAlertDashboard() {
  const [criticalDetections, setCriticalDetections] = useState<CriticalDetection[]>([]);
  const [selectedDetection, setSelectedDetection] = useState<CriticalDetection | null>(null);
  const [isDeploying, setIsDeploying] = useState(false);

  const detectionsQuery = trpc.detection.list.useQuery({
    limit: 100,
    offset: 0,
  });

  const deployDroneMutation = trpc.stations.update.useMutation();

  // Filter critical detections (85%+ confidence)
  useEffect(() => {
    if (detectionsQuery.data) {
      const critical = detectionsQuery.data
        .filter((d: any) => d.confidence > 0.85)
        .sort((a: any, b: any) => b.timestamp - a.timestamp)
        .map((d: any) => ({
          id: d.id,
          type: d.type,
          confidence: d.confidence,
          timestamp: typeof d.timestamp === 'string' ? new Date(d.timestamp).getTime() : d.timestamp,
          stationId: d.stationId,
          latitude: d.latitude ? parseFloat(d.latitude) : undefined,
          longitude: d.longitude ? parseFloat(d.longitude) : undefined,
          imageUrl: d.imageUrl,
        }));

      setCriticalDetections(critical);
    }
  }, [detectionsQuery.data]);

  const handleDeployDrone = async (detection: CriticalDetection) => {
    setIsDeploying(true);
    try {
      // Deploy drone mission
      // In a real app, this would call a drone deployment endpoint
      console.log('Deploying drone to:', detection);

      // Show success message
      alert(`Drone deployed to ${detection.type} detection at ${detection.stationId}`);

      // Send notification to rangers
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then((registration) => {
          registration.showNotification('Drone Deployed', {
            body: `Drone deployed to investigate ${detection.type} detection`,
            icon: '/favicon.ico',
            tag: 'drone-deployed',
          });
        });
      }
    } catch (error) {
      console.error('Failed to deploy drone:', error);
      alert('Failed to deploy drone');
    } finally {
      setIsDeploying(false);
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'human':
        return 'bg-red-100 text-red-800';
      case 'animal':
        return 'bg-green-100 text-green-800';
      case 'vehicle':
        return 'bg-blue-100 text-blue-800';
      case 'anonymous':
        return 'bg-purple-100 text-purple-800';
      case 'dark_environment':
        return 'bg-indigo-100 text-indigo-800';
      case 'blurry_image':
        return 'bg-gray-200 text-gray-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'human':
        return '👤';
      case 'animal':
        return '🦁';
      case 'vehicle':
        return '🚗';
      case 'anonymous':
        return '🕵️';
      case 'dark_environment':
        return '🌃';
      case 'blurry_image':
        return '🌫️';
      default:
        return '❓';
    }
  };

  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Ranger Alert Dashboard</h1>
            <p className="text-muted-foreground">Critical detections requiring immediate response</p>
          </div>
          <Badge className="bg-red-100 text-red-800 text-lg px-3 py-1">
            {criticalDetections.length} Critical
          </Badge>
        </div>

        {/* Main layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Critical detections list */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle>Critical Detections</CardTitle>
                <CardDescription>Detections with 85%+ confidence</CardDescription>
              </CardHeader>
              <CardContent>
                {detectionsQuery.isLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin" />
                  </div>
                ) : criticalDetections.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p>No critical detections</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {criticalDetections.map((detection) => (
                      <div
                        key={detection.id}
                        className={`p-4 border rounded-lg cursor-pointer transition-colors ${
                          selectedDetection?.id === detection.id
                            ? 'bg-blue-50 border-blue-300'
                            : 'hover:bg-gray-50'
                        }`}
                        onClick={() => setSelectedDetection(detection)}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-3">
                            <div className="text-3xl">{getTypeIcon(detection.type)}</div>
                            <div>
                              <div className="font-semibold capitalize">{detection.type}</div>
                              <div className="text-xs text-muted-foreground">
                                {new Date(detection.timestamp).toLocaleTimeString()}
                              </div>
                            </div>
                          </div>
                          <Badge className={getTypeColor(detection.type)}>
                            {(detection.confidence * 100).toFixed(1)}%
                          </Badge>
                        </div>

                        <div className="text-xs text-muted-foreground">
                          Station: {detection.stationId}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Detection details and drone deployment */}
          <div className="space-y-4">
            {selectedDetection ? (
              <>
                {/* Detection details */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Detection Details</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="text-center mb-4">
                      <div className="text-5xl mb-2">{getTypeIcon(selectedDetection.type)}</div>
                      <div className="text-2xl font-bold capitalize">{selectedDetection.type}</div>
                    </div>

                    <div className="space-y-3 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Confidence</span>
                        <span className="font-semibold">
                          {(selectedDetection.confidence * 100).toFixed(1)}%
                        </span>
                      </div>

                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Station</span>
                        <span className="font-semibold">{selectedDetection.stationId}</span>
                      </div>

                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Time</span>
                        <span className="font-semibold">
                          {new Date(selectedDetection.timestamp).toLocaleTimeString()}
                        </span>
                      </div>

                      {selectedDetection.latitude && selectedDetection.longitude && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Location</span>
                          <span className="font-semibold text-xs">
                            {selectedDetection.latitude.toFixed(4)}, {selectedDetection.longitude.toFixed(4)}
                          </span>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Drone deployment */}
                <Card className="border-orange-200 bg-orange-50">
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Rocket className="w-5 h-5" />
                      Drone Deployment
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      Deploy a drone to verify this detection and gather additional intelligence.
                    </p>

                    <Button
                      onClick={() => handleDeployDrone(selectedDetection)}
                      disabled={isDeploying}
                      className="w-full"
                      size="lg"
                    >
                      {isDeploying ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Deploying...
                        </>
                      ) : (
                        <>
                          <Rocket className="w-4 h-4 mr-2" />
                          Deploy Drone
                        </>
                      )}
                    </Button>
                  </CardContent>
                </Card>

                {/* Actions */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Actions</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <Button variant="outline" className="w-full">
                      <CheckCircle className="w-4 h-4 mr-2" />
                      Verify Detection
                    </Button>
                    <Button variant="outline" className="w-full">
                      <XCircle className="w-4 h-4 mr-2" />
                      Mark as False Alarm
                    </Button>
                  </CardContent>
                </Card>
              </>
            ) : (
              <Card>
                <CardContent className="flex items-center justify-center py-8">
                  <p className="text-muted-foreground">Select a detection to view details</p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
