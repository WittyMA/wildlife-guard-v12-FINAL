import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertCircle, Download, Filter, Loader2 } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { indexedDB } from '@/lib/indexeddb';

interface LocalDetection {
  id: string;
  type: 'human' | 'animal' | 'vehicle' | 'anonymous' | 'dark_environment' | 'blurry_image';
  confidence: number;
  timestamp: number;
  stationId: string;
}

export default function Detections() {
  const [detections, setDetections] = useState<LocalDetection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterType, setFilterType] = useState<'all' | 'human' | 'animal' | 'vehicle' | 'anonymous' | 'dark_environment' | 'blurry_image'>('all');

  const detectionsQuery = trpc.detection.list.useQuery({
    limit: 100,
    offset: 0,
  });

  // Load detections from both server and local storage
  useEffect(() => {
    const loadDetections = async () => {
      try {
        setIsLoading(true);

        // Get local detections
        const localDetections = await indexedDB.getDetections(100, 0);

        // Combine with server detections
        const allDetections = [
          ...localDetections,
          ...(detectionsQuery.data || []).map((d: any) => ({
            ...d,
            timestamp: typeof d.timestamp === 'string' ? new Date(d.timestamp).getTime() : d.timestamp,
          })),
        ].sort((a, b) => b.timestamp - a.timestamp);

        setDetections(allDetections as LocalDetection[]);
      } catch (error) {
        console.error('Failed to load detections:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadDetections();
  }, [detectionsQuery.data]);

  const filteredDetections = filterType === 'all'
    ? detections
    : detections.filter((d) => d.type === filterType);

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

  const exportData = (format: 'csv' | 'json') => {
    let content = '';
    const filename = `detections-${new Date().toISOString().split('T')[0]}`;

    if (format === 'csv') {
      content = 'ID,Type,Confidence,Timestamp,Station ID\n';
      filteredDetections.forEach((d) => {
        content += `${d.id},${d.type},${d.confidence},${new Date(d.timestamp).toISOString()},${d.stationId}\n`;
      });
    } else {
      content = JSON.stringify(filteredDetections, null, 2);
    }

    const blob = new Blob([content], {
      type: format === 'csv' ? 'text/csv' : 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Detection History</h1>
            <p className="text-muted-foreground">View and manage detection events</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => exportData('csv')}>
              <Download className="w-4 h-4 mr-2" />
              CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => exportData('json')}>
              <Download className="w-4 h-4 mr-2" />
              JSON
            </Button>
          </div>
        </div>

        {/* Filters */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Filter className="w-5 h-5" />
              Filters
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {(['all', 'human', 'animal', 'vehicle', 'anonymous', 'dark_environment', 'blurry_image'] as const).map((type) => (
                <Button
                  key={type}
                  variant={filterType === type ? 'default' : 'outline'}
                  onClick={() => setFilterType(type)}
                  className="capitalize"
                >
                  {type.replace('_', ' ')}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Detections list */}
        <div className="space-y-3">
          {isLoading ? (
            <Card>
              <CardContent className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin" />
              </CardContent>
            </Card>
          ) : filteredDetections.length === 0 ? (
            <Card>
              <CardContent className="flex items-center justify-center py-8">
                <div className="text-center text-muted-foreground">
                  <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>No detections found</p>
                </div>
              </CardContent>
            </Card>
          ) : (
            filteredDetections.map((detection) => (
              <Card key={detection.id}>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="text-3xl">{getTypeIcon(detection.type)}</div>
                      <div>
                        <div className="font-semibold capitalize">{detection.type}</div>
                        <div className="text-sm text-muted-foreground">
                          {new Date(detection.timestamp).toLocaleString()}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <div className="text-2xl font-bold">
                          {(detection.confidence * 100).toFixed(1)}%
                        </div>
                        <div className="text-xs text-muted-foreground">confidence</div>
                      </div>

                      <Badge className={getTypeColor(detection.type)}>
                        {detection.type}
                      </Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>

        {/* Stats */}
        {filteredDetections.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Total Detections</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{filteredDetections.length}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Average Confidence</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">
                  {(
                    (filteredDetections.reduce((sum, d) => sum + d.confidence, 0) /
                      filteredDetections.length) *
                    100
                  ).toFixed(1)}
                  %
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Critical Detections</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">
                  {filteredDetections.filter((d) => d.confidence > 0.85).length}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
