import { useRef, useState, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Camera, Wifi, Plane, Eye, Navigation } from 'lucide-react';
import { useScreenWakeLock, useNotifications } from '@/hooks/useCamera';
import { aiDetection, TrackedObject, MultiDetectionResult } from '@/lib/aiDetection';
import { vanillaTrpc } from '@/lib/trpcVanilla';
import { trpc } from '@/lib/trpc';

const BRIDGE_URL = 'http://localhost:5000';
const DETECTION_INTERVAL_MS = 300;
const DRONE_FOLLOW_INTERVAL_MS = 2000;
const DRONE_TRIGGER_COOLDOWN_MS = 60000;

interface DroneFollowState {
  isFollowing: boolean;
  targetTrackId: string | null;
  lastGpsSent: number;
  reason: string;
}

export default function Monitor() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const droneImgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const detectionTimerRef = useRef<number | null>(null);
  const isProcessingRef = useRef(false);
  const frameCountRef = useRef(0);
  const webcamStreamRef = useRef<MediaStream | null>(null);
  const canvasSizeRef = useRef({ width: 640, height: 480 });
  const lastDroneTriggerRef = useRef(0);
  const lastServerSendRef = useRef(0);
  const droneFollowRef = useRef<DroneFollowState>({
    isFollowing: false,
    targetTrackId: null,
    lastGpsSent: 0,
    reason: '',
  });

  const [isMonitoring, setIsMonitoring] = useState(false);
  const [trackedObjects, setTrackedObjects] = useState<TrackedObject[]>([]);
  const [frameMetrics, setFrameMetrics] = useState({ brightness: 0, sharpness: 0, motionLevel: 0, objectCount: 0 });
  const [fps, setFps] = useState(0);
  const [droneStatus, setDroneStatus] = useState<'idle' | 'following' | 'investigating'>('idle');
  const [droneMessage, setDroneMessage] = useState('');
  const [useDroneCamera, setUseDroneCamera] = useState(false);
  const [debugInfo, setDebugInfo] = useState('');
  const [cameraError, setCameraError] = useState('');
  const [totalDetections, setTotalDetections] = useState(0);
  const [droneVideoConnected, setDroneVideoConnected] = useState(false);

  const wakeLock = useScreenWakeLock();
  const notifications = useNotifications();
  const createDetectionMutation = trpc.detection.create.useMutation();

  // Initialize AI Detection Engine with vanilla tRPC client
  useEffect(() => {
    aiDetection.initialize().then(() => {
      aiDetection.setTrpcClient(vanillaTrpc);
      console.log('[Monitor] AI Detection Engine v8.0 ready - Dual Mode: Server AI + Conservative Local');
    });
  }, []);

  // ResizeObserver for canvas sizing
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          const w = Math.round(width);
          const h = Math.round(height);
          canvasSizeRef.current = { width: w, height: h };
          if (canvasRef.current) {
            canvasRef.current.width = w;
            canvasRef.current.height = h;
          }
        }
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // === WEBCAM ===
  const startWebcam = async (): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'environment' }
      });
      webcamStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        await new Promise<void>((resolve, reject) => {
          let attempts = 0;
          const check = () => {
            attempts++;
            if (videoRef.current && videoRef.current.readyState >= 2 && videoRef.current.videoWidth > 0) resolve();
            else if (attempts > 40) reject(new Error('Video not ready'));
            else setTimeout(check, 100);
          };
          check();
        });
        setCameraError('');
        return true;
      }
      return false;
    } catch (err: any) {
      setCameraError(`Camera error: ${err.message || 'Permission denied'}`);
      return false;
    }
  };

  const stopWebcam = () => {
    if (webcamStreamRef.current) {
      webcamStreamRef.current.getTracks().forEach(t => t.stop());
      webcamStreamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  // === DRONE CAMERA FEED ===
  // Uses snapshot polling (more reliable across browsers than MJPEG in <img>)
  const dronePollingRef = useRef<number | null>(null);
  const droneCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const startDroneCamera = () => {
    setDroneVideoConnected(false);
    // Start polling /snapshot every 200ms for drone camera frames
    const poll = async () => {
      try {
        const resp = await fetch(`${BRIDGE_URL}/snapshot`, { cache: 'no-store' });
        if (resp.ok) {
          const blob = await resp.blob();
          const url = URL.createObjectURL(blob);
          const img = droneImgRef.current;
          if (img) {
            img.onload = () => {
              URL.revokeObjectURL(url);
              setDroneVideoConnected(true);
            };
            img.src = url;
          }
        }
      } catch {
        // Bridge not reachable - will retry
      }
      if (dronePollingRef.current !== null) {
        dronePollingRef.current = window.setTimeout(poll, 200);
      }
    };
    dronePollingRef.current = window.setTimeout(poll, 100);
  };

  const stopDroneCamera = () => {
    if (dronePollingRef.current !== null) {
      clearTimeout(dronePollingRef.current);
      dronePollingRef.current = null;
    }
    if (droneImgRef.current) {
      droneImgRef.current.src = '';
    }
    setDroneVideoConnected(false);
  };

  // Capture drone frame to canvas for AI analysis
  const captureDroneFrame = (): HTMLCanvasElement | null => {
    const img = droneImgRef.current;
    if (!img || !img.complete || img.naturalWidth === 0) return null;

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = img.naturalWidth || 640;
    tempCanvas.height = img.naturalHeight || 480;
    const ctx = tempCanvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    return tempCanvas;
  };

  // === DRONE AUTO-FOLLOW ===
  const sendDroneFollowCommand = useCallback(async (target: TrackedObject, reason: string) => {
    const now = Date.now();
    const follow = droneFollowRef.current;

    if (!follow.isFollowing || follow.targetTrackId !== target.id) {
      if (now - lastDroneTriggerRef.current < DRONE_TRIGGER_COOLDOWN_MS && !follow.isFollowing) return;
      lastDroneTriggerRef.current = now;
      droneFollowRef.current = { isFollowing: true, targetTrackId: target.id, lastGpsSent: now, reason };
      setDroneStatus('following');
      setDroneMessage(reason);

      // DISPATCH: Send takeoff command FIRST to get the drone airborne
      console.log('[Monitor] DISPATCHING DRONE - sending takeoff command');
      try {
        await fetch(`${BRIDGE_URL}/command`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: 'takeoff' }),
        });
      } catch (err) {
        console.warn('[Monitor] Drone takeoff failed:', err);
      }
      // Wait 3 seconds for drone to reach stable hover before sending follow commands
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    if (now - droneFollowRef.current.lastGpsSent < DRONE_FOLLOW_INTERVAL_MS) return;
    droneFollowRef.current.lastGpsSent = now;

    const centerX = target.smoothedBox.x + target.smoothedBox.width / 2;
    const centerY = target.smoothedBox.y + target.smoothedBox.height / 2;

    let direction = 'forward';
    if (centerX < 0.3) direction = 'left';
    else if (centerX > 0.7) direction = 'right';
    if (centerY < 0.3) direction = direction === 'forward' ? 'up' : direction + '_up';
    else if (centerY > 0.7) direction = direction === 'forward' ? 'down' : direction + '_down';

    try {
      await fetch(`${BRIDGE_URL}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: 'follow_target',
          direction,
          target_x: centerX,
          target_y: centerY,
          velocity_dx: target.velocity.dx,
          velocity_dy: target.velocity.dy,
          confidence: target.confidence,
          track_id: target.id,
          reason,
        }),
      });
    } catch (err) {
      console.warn('[Monitor] Drone follow failed:', err);
    }
  }, []);

  const stopDroneFollow = useCallback(async () => {
    if (!droneFollowRef.current.isFollowing) return;
    droneFollowRef.current = { isFollowing: false, targetTrackId: null, lastGpsSent: 0, reason: '' };
    setDroneStatus('idle');
    setDroneMessage('');
    try {
      await fetch(`${BRIDGE_URL}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'hover' }),
      });
      setTimeout(async () => {
        try {
          await fetch(`${BRIDGE_URL}/command`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command: 'return_home' }),
          });
          console.log('[Monitor] Drone returning home after target lost');
        } catch { /* ignore */ }
      }, 5000);
    } catch { /* ignore */ }
  }, []);

  // === DRAW TRACKED OBJECTS ===
  const drawFrame = useCallback((tracked: TrackedObject[]) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const { width: cw, height: ch } = canvasSizeRef.current;
    if (cw === 0 || ch === 0) return;
    if (canvas.width !== cw) canvas.width = cw;
    if (canvas.height !== ch) canvas.height = ch;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, cw, ch);

    // Calculate video display area for letterbox offset
    let offsetX = 0, offsetY = 0, drawW = cw, drawH = ch;

    if (!useDroneCamera) {
      const videoEl = videoRef.current;
      if (videoEl && videoEl.videoWidth > 0 && videoEl.videoHeight > 0) {
        const videoAspect = videoEl.videoWidth / videoEl.videoHeight;
        const containerAspect = cw / ch;
        if (videoAspect > containerAspect) {
          drawW = cw;
          drawH = cw / videoAspect;
          offsetY = (ch - drawH) / 2;
        } else {
          drawH = ch;
          drawW = ch * videoAspect;
          offsetX = (cw - drawW) / 2;
        }
      }
    } else {
      const img = droneImgRef.current;
      if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
        const imgAspect = img.naturalWidth / img.naturalHeight;
        const containerAspect = cw / ch;
        if (imgAspect > containerAspect) {
          drawW = cw;
          drawH = cw / imgAspect;
          offsetY = (ch - drawH) / 2;
        } else {
          drawH = ch;
          drawW = ch * imgAspect;
          offsetX = (cw - drawW) / 2;
        }
      }
    }

    for (const obj of tracked) {
      const box = obj.smoothedBox;
      const color = getTypeColor(obj.type);

      const bx = Math.round(offsetX + box.x * drawW);
      const by = Math.round(offsetY + box.y * drawH);
      const bw = Math.round(box.width * drawW);
      const bh = Math.round(box.height * drawH);

      if (bw < 8 || bh < 8) continue;

      ctx.save();

      // Bounding box with glow effect
      ctx.shadowColor = color;
      ctx.shadowBlur = 4;
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.strokeRect(bx, by, bw, bh);
      ctx.shadowBlur = 0;

      // Corner brackets
      ctx.lineWidth = 5;
      ctx.lineCap = 'square';
      const corner = Math.max(12, Math.min(bw, bh) * 0.2);

      ctx.beginPath();
      ctx.moveTo(bx, by + corner); ctx.lineTo(bx, by); ctx.lineTo(bx + corner, by);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(bx + bw - corner, by); ctx.lineTo(bx + bw, by); ctx.lineTo(bx + bw, by + corner);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(bx, by + bh - corner); ctx.lineTo(bx, by + bh); ctx.lineTo(bx + corner, by + bh);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(bx + bw - corner, by + bh); ctx.lineTo(bx + bw, by + bh); ctx.lineTo(bx + bw, by + bh - corner);
      ctx.stroke();

      // Caption label
      const label = obj.label;
      ctx.font = 'bold 14px Arial, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      const textW = ctx.measureText(label).width;
      const labelH = 22;
      const labelX = bx;
      const labelY = by > labelH + 4 ? by - 4 : by + bh + labelH + 4;

      ctx.fillStyle = color;
      ctx.fillRect(labelX, labelY - labelH, textW + 16, labelH);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(label, labelX + 8, labelY - 5);

      // Tracking dot
      if (obj.framesTracked > 3) {
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.arc(bx + bw - 8, by + 8, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // Drone follow indicator
      if (droneFollowRef.current.isFollowing && droneFollowRef.current.targetTrackId === obj.id) {
        ctx.strokeStyle = '#FF0000';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(bx - 4, by - 4, bw + 8, bh + 8);
        ctx.setLineDash([]);

        ctx.fillStyle = '#FF0000';
        ctx.font = 'bold 11px Arial, sans-serif';
        ctx.textBaseline = 'top';
        const ft = 'DRONE FOLLOWING';
        const ftw = ctx.measureText(ft).width;
        ctx.fillRect(bx, by + bh + 6, ftw + 12, 16);
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(ft, bx + 6, by + bh + 9);
      }

      ctx.restore();
    }

    // Status bar
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.fillRect(0, ch - 32, cw, 32);
    ctx.font = '12px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#00FF88';
    ctx.fillText(`● LIVE | ${new Date().toLocaleTimeString()} | Objects: ${tracked.length} | FPS: ${fps}`, 10, ch - 16);
    ctx.textAlign = 'right';
    if (droneStatus === 'following') {
      ctx.fillStyle = '#FF4444';
      ctx.fillText('DRONE: FOLLOWING TARGET', cw - 10, ch - 16);
    } else {
      ctx.fillStyle = '#88FF88';
      ctx.fillText('DRONE: STANDBY', cw - 10, ch - 16);
    }
    ctx.restore();
  }, [fps, droneStatus, useDroneCamera]);

  const getTypeColor = (type: string): string => {
    switch (type) {
      case 'human': return '#FF2222';
      case 'animal': return '#FF8800';
      case 'vehicle': return '#2288FF';
      case 'anonymous': return '#CC00FF';
      default: return '#00FF00';
    }
  };

  // === SEND TO SERVER (throttled) ===
  const sendToServer = useCallback(async (obj: TrackedObject) => {
    const now = Date.now();
    if (now - lastServerSendRef.current < 10000) return;
    lastServerSendRef.current = now;
    try {
      await createDetectionMutation.mutateAsync({
        type: obj.type as any,
        confidence: obj.confidence,
        stationId: 'default',
        boundingBox: obj.smoothedBox,
        latitude: 0,
        longitude: 0,
      });
    } catch { /* offline */ }
  }, [createDetectionMutation]);

  // === MAIN DETECTION LOOP ===
  const runDetection = useCallback(async () => {
    if (!isMonitoring || isProcessingRef.current) {
      if (isMonitoring) detectionTimerRef.current = window.setTimeout(runDetection, 50);
      return;
    }

    isProcessingRef.current = true;
    frameCountRef.current++;
    const t0 = performance.now();

    try {
      let source: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement | null = null;

      if (useDroneCamera) {
        // For drone camera, capture the current MJPEG frame from the <img> tag
        const captured = captureDroneFrame();
        if (!captured) {
          setDebugInfo('Drone: waiting for video stream...');
          isProcessingRef.current = false;
          detectionTimerRef.current = window.setTimeout(runDetection, 500);
          return;
        }
        source = captured;
      } else {
        const video = videoRef.current;
        if (!video || video.readyState < 2 || video.videoWidth === 0) {
          setDebugInfo('Webcam: waiting...');
          isProcessingRef.current = false;
          detectionTimerRef.current = window.setTimeout(runDetection, 200);
          return;
        }
        source = video;
      }

      const result: MultiDetectionResult = await aiDetection.detectMulti(source);
      const elapsed = performance.now() - t0;
      setFps(Math.round(1000 / Math.max(elapsed + DETECTION_INTERVAL_MS, 1)));
      setFrameMetrics(result.frameMetrics);
      setTrackedObjects(result.tracked);

      // DRAW every frame
      drawFrame(result.tracked);

      setDebugInfo(
        `Frame #${frameCountRef.current} | ${result.tracked.length} tracked | ` +
        `${elapsed.toFixed(0)}ms | Bright: ${result.frameMetrics.brightness.toFixed(0)} | ` +
        `Sharp: ${result.frameMetrics.sharpness.toFixed(1)} | Motion: ${(result.frameMetrics.motionLevel * 100).toFixed(1)}%`
      );

      if (result.tracked.length > 0) {
        setTotalDetections(prev => prev + 1);
        const best = result.tracked.reduce((a, b) => a.confidence > b.confidence ? a : b);
        if (best.confidence > 0.55 && best.framesTracked > 3) {
          await sendToServer(best);
        }
      }

      // Drone auto-follow
      if (result.shouldTriggerDrone && result.droneTarget) {
        await sendDroneFollowCommand(result.droneTarget, result.droneReason || 'Anonymous object');
      } else if (droneFollowRef.current.isFollowing) {
        const target = result.tracked.find(t => t.id === droneFollowRef.current.targetTrackId);
        if (target) {
          await sendDroneFollowCommand(target, droneFollowRef.current.reason);
        } else {
          await stopDroneFollow();
        }
      }

    } catch (error) {
      console.error('[Monitor] Error:', error);
      setDebugInfo(`ERROR: ${error}`);
    } finally {
      isProcessingRef.current = false;
    }

    if (isMonitoring) {
      detectionTimerRef.current = window.setTimeout(runDetection, DETECTION_INTERVAL_MS);
    }
  }, [isMonitoring, useDroneCamera, drawFrame, sendToServer, sendDroneFollowCommand, stopDroneFollow]);

  useEffect(() => {
    if (isMonitoring) detectionTimerRef.current = window.setTimeout(runDetection, 300);
    return () => { if (detectionTimerRef.current) clearTimeout(detectionTimerRef.current); };
  }, [isMonitoring, runDetection]);

  // === START / STOP ===
  const startMonitoring = async () => {
    setCameraError('');
    aiDetection.reset(); // Clear previous tracking state
    if (useDroneCamera) {
      startDroneCamera();
    } else {
      const ok = await startWebcam();
      if (!ok) return;
    }
    await notifications.requestPermission();
    await wakeLock.request();
    setIsMonitoring(true);
    setTotalDetections(0);
    frameCountRef.current = 0;
  };

  const stopMonitoring = async () => {
    setIsMonitoring(false);
    if (detectionTimerRef.current) { clearTimeout(detectionTimerRef.current); detectionTimerRef.current = null; }
    if (useDroneCamera) {
      stopDroneCamera();
    } else {
      stopWebcam();
    }
    await wakeLock.release();
    await stopDroneFollow();
    const canvas = canvasRef.current;
    if (canvas) { const ctx = canvas.getContext('2d'); if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height); }
    setTrackedObjects([]);
  };

  useEffect(() => {
    return () => {
      stopWebcam();
      stopDroneCamera();
      if (detectionTimerRef.current) clearTimeout(detectionTimerRef.current);
      if (dronePollingRef.current) clearTimeout(dronePollingRef.current);
    };
  }, []);

  // === RENDER ===
  return (
    <div className="p-4 space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Wildlife Guard - Live Monitor</h1>
          <p className="text-muted-foreground text-sm">Real-time object tracking with drone auto-follow</p>
        </div>
        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
          <Wifi className="w-3 h-3 mr-1" /> Online
        </Badge>
      </div>

      {droneStatus !== 'idle' && (
        <div className="bg-red-100 border-2 border-red-400 rounded-lg p-3 flex items-center gap-3 animate-pulse">
          <Navigation className="w-6 h-6 text-red-600" />
          <div>
            <span className="font-bold text-red-800">DRONE {droneStatus.toUpperCase()}: </span>
            <span className="text-red-700">{droneMessage}</span>
          </div>
          <Button size="sm" variant="outline" className="ml-auto" onClick={stopDroneFollow}>Recall</Button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between py-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Camera className="w-5 h-5" /> Live Feed
              </CardTitle>
              <div className="flex gap-2">
                <Button variant={useDroneCamera ? "default" : "outline"} size="sm"
                  onClick={() => { if (isMonitoring) stopMonitoring(); setUseDroneCamera(true); }}>
                  <Plane className="w-4 h-4 mr-1" /> Drone
                </Button>
                <Button variant={!useDroneCamera ? "default" : "outline"} size="sm"
                  onClick={() => { if (isMonitoring) stopMonitoring(); setUseDroneCamera(false); }}>
                  <Camera className="w-4 h-4 mr-1" /> Webcam
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pt-0 space-y-3">
              <div
                ref={containerRef}
                style={{
                  position: 'relative',
                  width: '100%',
                  aspectRatio: '16/9',
                  minHeight: '320px',
                  backgroundColor: '#000',
                  borderRadius: '8px',
                  overflow: 'hidden',
                }}
              >
                {/* Webcam video element */}
                <video ref={videoRef} autoPlay playsInline muted
                  style={{
                    position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
                    objectFit: 'contain',
                    display: (!useDroneCamera && isMonitoring) ? 'block' : 'none'
                  }} />

                {/* Drone camera frames via snapshot polling */}
                <img
                  ref={droneImgRef}
                  alt="Drone Camera Feed"
                  style={{
                    position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
                    objectFit: 'contain',
                    display: (useDroneCamera && isMonitoring) ? 'block' : 'none'
                  }}
                />

                {/* Detection overlay canvas */}
                <canvas ref={canvasRef}
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 50, pointerEvents: 'none' }} />

                {/* Idle state */}
                {!isMonitoring && (
                  <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.5)', gap: '12px' }}>
                    <Eye style={{ width: 64, height: 64 }} />
                    <span style={{ fontSize: '16px' }}>Click Start to begin monitoring</span>
                  </div>
                )}
              </div>

              {cameraError && <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{cameraError}</div>}
              {isMonitoring && debugInfo && <div className="text-xs font-mono text-muted-foreground bg-secondary/50 px-3 py-1.5 rounded border">{debugInfo}</div>}
              {useDroneCamera && isMonitoring && !droneVideoConnected && (
                <div className="text-sm text-yellow-700 bg-yellow-50 px-3 py-2 rounded border border-yellow-200">
                  Connecting to drone camera at {BRIDGE_URL}/video_feed... Make sure the bridge is running and drone WiFi is connected.
                </div>
              )}

              <div className="flex justify-center">
                {!isMonitoring ? (
                  <Button onClick={startMonitoring} size="lg" className="w-full max-w-md bg-green-600 hover:bg-green-700 text-white">
                    <Eye className="w-5 h-5 mr-2" /> Start Proactive Monitoring
                  </Button>
                ) : (
                  <Button onClick={stopMonitoring} variant="destructive" size="lg" className="w-full max-w-md">
                    Stop Monitoring
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="py-3"><CardTitle className="text-lg">Tracked Objects</CardTitle></CardHeader>
            <CardContent>
              {trackedObjects.length > 0 ? (
                <div className="space-y-2">
                  {trackedObjects.map((obj) => (
                    <div key={obj.id} className="flex items-center justify-between p-2 rounded bg-secondary/50 border-l-4"
                      style={{ borderLeftColor: getTypeColor(obj.type) }}>
                      <div>
                        <div className="font-medium text-sm">{obj.type.toUpperCase()}</div>
                        <div className="text-xs text-muted-foreground">{obj.framesTracked} frames</div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-sm font-bold">{(obj.confidence * 100).toFixed(0)}%</div>
                        {droneFollowRef.current.targetTrackId === obj.id && (
                          <Badge variant="destructive" className="text-xs">FOLLOWING</Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-center text-muted-foreground py-4 text-sm">
                  {isMonitoring ? 'Scanning...' : 'Start monitoring to detect'}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="py-3"><CardTitle className="text-lg">Metrics</CardTitle></CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              <div className="flex justify-between"><span>Brightness</span><span className="font-mono">{frameMetrics.brightness.toFixed(0)}</span></div>
              <div className="flex justify-between"><span>Sharpness</span><span className="font-mono">{frameMetrics.sharpness.toFixed(1)}</span></div>
              <div className="flex justify-between"><span>Motion</span><span className="font-mono">{(frameMetrics.motionLevel * 100).toFixed(1)}%</span></div>
              <div className="flex justify-between"><span>Objects</span><span className="font-mono">{frameMetrics.objectCount}</span></div>
              <div className="flex justify-between"><span>FPS</span><span className="font-mono">{fps}</span></div>
              <div className="flex justify-between"><span>Total</span><span className="font-mono">{totalDetections}</span></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-lg flex items-center gap-2"><Plane className="w-4 h-4" /> Drone</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2 mb-2">
                <div className={`w-3 h-3 rounded-full ${droneStatus === 'idle' ? 'bg-green-500' : 'bg-red-500 animate-pulse'}`} />
                <span className="font-medium capitalize">{droneStatus}</span>
              </div>
              {droneMessage && <p className="text-xs text-muted-foreground">{droneMessage}</p>}
              <div className="mt-3 text-xs text-muted-foreground space-y-1">
                <p>Auto-follows anonymous/blur objects</p>
                <p>GPS updates every 2s while following</p>
                <p>60s cooldown between new triggers</p>
              </div>
              {useDroneCamera && (
                <div className="mt-3 pt-3 border-t">
                  <div className="flex items-center gap-2 text-xs">
                    <div className={`w-2 h-2 rounded-full ${droneVideoConnected ? 'bg-green-500' : 'bg-yellow-500 animate-pulse'}`} />
                    <span>{droneVideoConnected ? 'Camera connected' : 'Camera connecting...'}</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
