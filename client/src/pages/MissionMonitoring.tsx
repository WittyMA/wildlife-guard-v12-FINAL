/**
 * Real-Time Mission Monitoring Dashboard
 * Displays active drone missions with live status, battery/signal indicators, and quick actions
 */

import { useEffect, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertCircle,
  Battery,
  Signal,
  Clock,
  MapPin,
  Zap,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Play,
  Pause,
  StopCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface MissionStatus {
  id: string;
  status: 'pending' | 'launched' | 'in_progress' | 'completed' | 'failed';
  droneId: string | null;
  batteryLevel?: number;
  signalStrength?: number;
  launchedAt?: Date;
  createdAt: Date;
}

export default function MissionMonitoring() {
  const [selectedMission, setSelectedMission] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [showAbortDialog, setShowAbortDialog] = useState(false);
  const [abortReason, setAbortReason] = useState('');

  // Fetch active missions
  const { data: activeMissions, isLoading: missionsLoading, refetch: refetchMissions } = trpc.monitoring.getActiveMissions.useQuery(undefined, {
    refetchInterval: autoRefresh ? 5000 : false,
  });

  // Fetch mission stats
  const { data: stats } = trpc.monitoring.getMissionStats.useQuery(undefined, {
    refetchInterval: autoRefresh ? 10000 : false,
  });

  // Fetch selected mission details
  const { data: missionDetails } = trpc.monitoring.getMissionDetails.useQuery(
    { missionId: selectedMission || '' },
    { enabled: !!selectedMission }
  );

  // Fetch mission health
  const { data: missionHealth } = trpc.monitoring.getMissionHealth.useQuery(
    { missionId: selectedMission || '' },
    { enabled: !!selectedMission, refetchInterval: autoRefresh ? 3000 : false }
  );

  // Mission control mutations
  const updateStatusMutation = trpc.missions.updateStatus.useMutation({
    onSuccess: (data) => {
      toast.success(`Mission status updated to ${data.status}`);
      refetchMissions();
    },
    onError: (error) => {
      toast.error(`Failed to update mission: ${error.message}`);
    },
  });

  const abortMissionMutation = trpc.missions.abort.useMutation({
    onSuccess: () => {
      toast.success('Mission aborted successfully');
      setShowAbortDialog(false);
      setAbortReason('');
      refetchMissions();
      setSelectedMission(null);
    },
    onError: (error) => {
      toast.error(`Failed to abort mission: ${error.message}`);
    },
  });

  const markInProgressMutation = trpc.missions.markInProgress.useMutation({
    onSuccess: () => {
      toast.success('Mission marked as in-progress');
      refetchMissions();
    },
    onError: (error) => {
      toast.error(`Failed to update mission: ${error.message}`);
    },
  });

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
      pending: { color: 'bg-yellow-100 text-yellow-800', icon: <Clock className="w-3 h-3" />, label: 'Pending' },
      launched: { color: 'bg-blue-100 text-blue-800', icon: <Zap className="w-3 h-3" />, label: 'Launched' },
      in_progress: { color: 'bg-green-100 text-green-800', icon: <AlertCircle className="w-3 h-3" />, label: 'In Progress' },
      completed: { color: 'bg-emerald-100 text-emerald-800', icon: <CheckCircle className="w-3 h-3" />, label: 'Completed' },
      failed: { color: 'bg-red-100 text-red-800', icon: <XCircle className="w-3 h-3" />, label: 'Failed' },
    };

    const config = statusConfig[status] || statusConfig.pending;
    return (
      <Badge className={config.color} variant="outline">
        <span className="flex items-center gap-1">
          {config.icon}
          {config.label}
        </span>
      </Badge>
    );
  };

  const getBatteryColor = (level?: number) => {
    if (!level) return 'text-gray-400';
    if (level > 60) return 'text-green-600';
    if (level > 30) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getSignalColor = (strength?: number) => {
    if (!strength) return 'text-gray-400';
    if (strength > 70) return 'text-green-600';
    if (strength > 40) return 'text-yellow-600';
    return 'text-red-600';
  };

  const handleUpdateStatus = (newStatus: 'launched' | 'in_progress' | 'completed' | 'failed') => {
    if (!selectedMission) return;
    updateStatusMutation.mutate({
      missionId: selectedMission,
      status: newStatus,
    });
  };

  const handleAbortMission = () => {
    if (!selectedMission) return;
    abortMissionMutation.mutate({
      missionId: selectedMission,
      reason: abortReason || 'Aborted by ranger',
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-slate-900 mb-2">Mission Monitoring</h1>
          <p className="text-slate-600">Real-time tracking of active drone missions</p>
        </div>

        {/* Stats Overview */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-8">
          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <div className="text-3xl font-bold text-slate-900">{stats?.total || 0}</div>
                <p className="text-sm text-slate-600 mt-1">Total Missions</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <div className="text-3xl font-bold text-yellow-600">{stats?.pending || 0}</div>
                <p className="text-sm text-slate-600 mt-1">Pending</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <div className="text-3xl font-bold text-blue-600">{stats?.launched || 0}</div>
                <p className="text-sm text-slate-600 mt-1">Launched</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <div className="text-3xl font-bold text-green-600">{stats?.inProgress || 0}</div>
                <p className="text-sm text-slate-600 mt-1">In Progress</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <div className="text-3xl font-bold text-emerald-600">{stats?.completed || 0}</div>
                <p className="text-sm text-slate-600 mt-1">Completed</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Controls */}
        <div className="flex gap-4 mb-6">
          <Button
            variant={autoRefresh ? 'default' : 'outline'}
            onClick={() => setAutoRefresh(!autoRefresh)}
            className="flex items-center gap-2"
          >
            <Zap className="w-4 h-4" />
            {autoRefresh ? 'Auto-Refresh: ON' : 'Auto-Refresh: OFF'}
          </Button>
          <Button
            variant="outline"
            onClick={() => refetchMissions()}
            className="flex items-center gap-2"
          >
            <Clock className="w-4 h-4" />
            Refresh Now
          </Button>
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Missions List */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle>Active Missions</CardTitle>
                <CardDescription>
                  {missionsLoading ? 'Loading...' : `${activeMissions?.length || 0} active missions`}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {missionsLoading ? (
                  <div className="text-center py-8 text-slate-500">Loading missions...</div>
                ) : activeMissions && activeMissions.length > 0 ? (
                  <div className="space-y-4">
                    {activeMissions.map((mission) => (
                      <div
                        key={mission.id}
                        onClick={() => setSelectedMission(mission.id)}
                        className={`p-4 border rounded-lg cursor-pointer transition-all ${
                          selectedMission === mission.id
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-start justify-between mb-3">
                          <div>
                            <p className="font-semibold text-slate-900">Mission {mission.id.slice(0, 8)}</p>
                            <p className="text-sm text-slate-500">Drone: {mission.droneId || 'Unassigned'}</p>
                          </div>
                          {getStatusBadge(mission.status)}
                        </div>

                        <div className="grid grid-cols-3 gap-4 pt-3 border-t border-slate-200">
                          <div className="flex items-center gap-2">
                            <Battery className={`w-4 h-4 ${getBatteryColor(75)}`} />
                            <span className="text-sm text-slate-600">75%</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Signal className={`w-4 h-4 ${getSignalColor(85)}`} />
                            <span className="text-sm text-slate-600">85%</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Clock className="w-4 h-4 text-slate-400" />
                            <span className="text-sm text-slate-600">
                              {mission.launchedAt
                                ? Math.floor((Date.now() - new Date(mission.launchedAt).getTime()) / 1000 / 60)
                                : 0}
                              m
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-slate-500">No active missions</div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Mission Details Panel */}
          <div>
            {selectedMission && missionDetails ? (
              <Card>
                <CardHeader>
                  <CardTitle>Mission Details</CardTitle>
                  <CardDescription>ID: {selectedMission.slice(0, 8)}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Status */}
                  <div>
                    <p className="text-sm font-semibold text-slate-600 mb-2">Status</p>
                    {getStatusBadge(missionDetails.mission.status)}
                  </div>

                  {/* Location */}
                  {missionDetails.station && (
                    <div>
                      <p className="text-sm font-semibold text-slate-600 mb-2 flex items-center gap-2">
                        <MapPin className="w-4 h-4" />
                        Station
                      </p>
                      <p className="text-sm text-slate-700">{missionDetails.station.name}</p>
                    </div>
                  )}

                  {/* Target Coordinates */}
                  <div>
                    <p className="text-sm font-semibold text-slate-600 mb-2">Target Coordinates</p>
                    <p className="text-sm text-slate-700">
                      {parseFloat(String(missionDetails.mission.targetLatitude)).toFixed(4)}°,{' '}
                      {parseFloat(String(missionDetails.mission.targetLongitude)).toFixed(4)}°
                    </p>
                  </div>

                  {/* Health Metrics */}
                  {missionHealth && (
                    <div>
                      <p className="text-sm font-semibold text-slate-600 mb-3">Health Metrics</p>
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-slate-600 flex items-center gap-2">
                            <Battery className={`w-4 h-4 ${getBatteryColor(missionHealth.batteryLevel)}`} />
                            Battery
                          </span>
                          <span className="text-sm font-semibold">{missionHealth.batteryLevel}%</span>
                        </div>
                        <div className="w-full bg-slate-200 rounded-full h-2">
                          <div
                            className={`h-2 rounded-full ${
                              missionHealth.batteryLevel > 60
                                ? 'bg-green-500'
                                : missionHealth.batteryLevel > 30
                                  ? 'bg-yellow-500'
                                  : 'bg-red-500'
                            }`}
                            style={{ width: `${missionHealth.batteryLevel}%` }}
                          />
                        </div>

                        <div className="flex items-center justify-between mt-4">
                          <span className="text-sm text-slate-600 flex items-center gap-2">
                            <Signal className={`w-4 h-4 ${getSignalColor(missionHealth.signalStrength)}`} />
                            Signal
                          </span>
                          <span className="text-sm font-semibold">{missionHealth.signalStrength}%</span>
                        </div>
                        <div className="w-full bg-slate-200 rounded-full h-2">
                          <div
                            className={`h-2 rounded-full ${
                              missionHealth.signalStrength > 70
                                ? 'bg-green-500'
                                : missionHealth.signalStrength > 40
                                  ? 'bg-yellow-500'
                                  : 'bg-red-500'
                            }`}
                            style={{ width: `${missionHealth.signalStrength}%` }}
                          />
                        </div>

                        <div className="flex items-center justify-between mt-4">
                          <span className="text-sm text-slate-600 flex items-center gap-2">
                            <Clock className="w-4 h-4 text-slate-400" />
                            Flight Time
                          </span>
                          <span className="text-sm font-semibold">{missionHealth.flightTime}m</span>
                        </div>

                        <div className="flex items-center justify-between">
                          <span className="text-sm text-slate-600">Est. Remaining</span>
                          <span className="text-sm font-semibold">{missionHealth.estimatedRemainingTime}m</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Warnings */}
                  {missionHealth && missionHealth.warnings.length > 0 && (
                    <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-yellow-600 mt-0.5" />
                        <div>
                          <p className="text-sm font-semibold text-yellow-800 mb-1">Warnings</p>
                          <ul className="text-sm text-yellow-700 space-y-1">
                            {missionHealth.warnings.map((warning, idx) => (
                              <li key={idx}>• {warning}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Quick Actions */}
                  <div className="mt-6 space-y-2 pt-4 border-t border-slate-200">
                    {missionDetails.mission.status === 'pending' && (
                      <Button
                        className="w-full"
                        onClick={() => handleUpdateStatus('launched')}
                        disabled={updateStatusMutation.isPending}
                      >
                        <Play className="w-4 h-4 mr-2" />
                        Launch Mission
                      </Button>
                    )}

                    {missionDetails.mission.status === 'launched' && (
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() => markInProgressMutation.mutate({ missionId: selectedMission })}
                        disabled={markInProgressMutation.isPending}
                      >
                        <Pause className="w-4 h-4 mr-2" />
                        Mark In Progress
                      </Button>
                    )}

                    {['pending', 'launched', 'in_progress'].includes(missionDetails.mission.status) && (
                      <Button
                        variant="destructive"
                        className="w-full"
                        onClick={() => setShowAbortDialog(true)}
                      >
                        <StopCircle className="w-4 h-4 mr-2" />
                        Abort Mission
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="pt-6">
                  <div className="text-center py-8 text-slate-500">
                    <p>Select a mission to view details</p>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>

      {/* Abort Confirmation Dialog */}
      <AlertDialog open={showAbortDialog} onOpenChange={setShowAbortDialog}>
        <AlertDialogContent>
          <AlertDialogTitle>Abort Mission?</AlertDialogTitle>
          <AlertDialogDescription>
            This will immediately abort the mission and mark it as failed. This action cannot be undone.
          </AlertDialogDescription>
          <div className="my-4">
            <label className="text-sm font-medium text-slate-700 mb-2 block">Reason for abort:</label>
            <input
              type="text"
              value={abortReason}
              onChange={(e) => setAbortReason(e.target.value)}
              placeholder="e.g., Signal lost, Safety concern, Maintenance needed"
              className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex gap-3">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleAbortMission}
              disabled={abortMissionMutation.isPending}
              className="bg-red-600 hover:bg-red-700"
            >
              {abortMissionMutation.isPending ? 'Aborting...' : 'Abort Mission'}
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
