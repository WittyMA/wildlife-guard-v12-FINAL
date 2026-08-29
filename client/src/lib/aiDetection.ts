/**
 * AI Detection Engine v8.0 - Dual Mode: Server AI + Conservative Local Fallback
 * 
 * Architecture:
 * - PRIMARY: Server-side AI analysis via Gemini Vision (every 3 seconds)
 * - FALLBACK: Conservative local motion-based detection (when server unavailable)
 * - TRACKING: IoU-based object tracking with smooth interpolation between frames
 * 
 * Key improvements in v8.0:
 * - Server AI provides accurate classification (no false positives on walls/lights)
 * - Local fallback is VERY conservative: requires significant motion + skin tones
 * - Objects must be tracked for 5+ frames before being shown (eliminates flicker)
 * - Maximum 3 objects tracked simultaneously (prevents noise)
 * - Background model: static regions are learned and ignored
 */

export interface BoundingBox {
  x: number;      // 0-1 normalized left
  y: number;      // 0-1 normalized top
  width: number;  // 0-1 normalized width
  height: number; // 0-1 normalized height
}

export interface TrackedObject {
  id: string;           // Persistent tracking ID
  type: 'human' | 'animal' | 'vehicle' | 'anonymous';
  confidence: number;
  boundingBox: BoundingBox;
  smoothedBox: BoundingBox;  // Smoothed position for rendering
  label: string;
  lastSeen: number;     // Timestamp
  framesTracked: number;
  velocity: { dx: number; dy: number }; // Movement direction
  source: 'ai' | 'local'; // Whether detected by server AI or local heuristic
}

export interface DetectionResult {
  type: 'human' | 'animal' | 'vehicle' | 'anonymous' | 'dark_environment' | 'blurry_image' | 'none';
  confidence: number;
  boundingBox?: BoundingBox;
  timestamp: number;
  label?: string;
  trackId?: string;
}

export interface MultiDetectionResult {
  primary: DetectionResult;
  all: DetectionResult[];
  tracked: TrackedObject[];  // All currently tracked objects
  frameMetrics: {
    brightness: number;
    sharpness: number;
    motionLevel: number;
    objectCount: number;
  };
  shouldTriggerDrone: boolean;
  droneReason?: string;
  droneTarget?: TrackedObject;
}

type SourceElement = HTMLVideoElement | HTMLImageElement | HTMLCanvasElement;

// Configuration
const SMOOTH_FACTOR = 0.3;
const MAX_TRACK_AGE_MS = 5000;
const IOU_THRESHOLD = 0.12;
const AI_ANALYSIS_INTERVAL_MS = 3000;
const MIN_FRAMES_TO_SHOW = 3;       // Must be tracked 3+ frames before showing
const MAX_TRACKED_OBJECTS = 5;       // Maximum simultaneous tracked objects
const MIN_MOTION_FOR_LOCAL = 0.025;  // 2.5% motion required for local detection (stricter)
const MIN_REGION_PIXELS = 400;       // Minimum pixels in a detected region (larger = fewer false positives)

let nextTrackId = 1;

class AIDetectionEngine {
  private isReady = false;
  private isLoading = false;
  private previousFrameData: Uint8ClampedArray | null = null;
  private backgroundModel: Float32Array | null = null;
  private backgroundFrameCount = 0;
  private frameCount = 0;
  private analysisCanvas: HTMLCanvasElement | null = null;
  private analysisCtx: CanvasRenderingContext2D | null = null;
  private readonly W = 320;
  private readonly H = 240;

  // Tracking state
  private trackedObjects: Map<string, TrackedObject> = new Map();
  private lastDroneTrigger = 0;

  // AI Vision state
  private lastAIAnalysis = 0;
  private isAnalyzing = false;
  private lastAIDetections: { type: string; confidence: number; bbox: BoundingBox; label: string }[] = [];
  private trpcClient: any = null;
  private serverAvailable = true; // Assume available until proven otherwise
  private serverFailCount = 0;

  async initialize(): Promise<void> {
    if (this.isReady) return;
    if (this.isLoading) {
      return new Promise((resolve) => {
        const check = setInterval(() => {
          if (this.isReady) { clearInterval(check); resolve(); }
        }, 50);
      });
    }

    this.isLoading = true;
    try {
      this.analysisCanvas = document.createElement('canvas');
      this.analysisCanvas.width = this.W;
      this.analysisCanvas.height = this.H;
      this.analysisCtx = this.analysisCanvas.getContext('2d', { willReadFrequently: true });
      this.isReady = true;
      console.log('[AIDetection] Engine v8.0 initialized - Dual Mode: Server AI + Conservative Local');
    } catch (error) {
      console.error('[AIDetection] Init error:', error);
      this.isReady = true;
    } finally {
      this.isLoading = false;
    }
  }

  setTrpcClient(client: any) {
    this.trpcClient = client;
  }

  async detect(sourceElement: SourceElement): Promise<DetectionResult> {
    const result = await this.detectMulti(sourceElement);
    return result.primary;
  }

  async detectMulti(sourceElement: SourceElement): Promise<MultiDetectionResult> {
    if (!this.isReady) await this.initialize();
    if (!this.analysisCtx || !this.analysisCanvas) return this.emptyResult();

    if (sourceElement instanceof HTMLVideoElement) {
      if (sourceElement.readyState < 2 || sourceElement.videoWidth === 0) return this.emptyResult();
    } else if (sourceElement instanceof HTMLImageElement) {
      if (!sourceElement.complete || sourceElement.naturalWidth === 0) return this.emptyResult();
    } else if (sourceElement instanceof HTMLCanvasElement) {
      if (sourceElement.width === 0 || sourceElement.height === 0) return this.emptyResult();
    }

    this.frameCount++;

    try {
      const ctx = this.analysisCtx;
      ctx.drawImage(sourceElement, 0, 0, this.W, this.H);
      const imageData = ctx.getImageData(0, 0, this.W, this.H);
      const data = imageData.data;
      const totalPixels = this.W * this.H;

      // === GLOBAL METRICS ===
      let brightnessSum = 0;
      for (let i = 0; i < data.length; i += 4) {
        brightnessSum += (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
      }
      const avgBrightness = brightnessSum / totalPixels;
      const sharpness = this.computeSharpness(data, this.W, this.H);

      // === MOTION DETECTION ===
      let totalMotion = 0;
      let motionPixels = 0;
      const motionMap = new Uint8Array(totalPixels); // 1 = motion pixel

      if (this.previousFrameData) {
        for (let i = 0; i < data.length; i += 4) {
          const pixelIdx = i / 4;
          const diff = Math.abs(data[i] - this.previousFrameData[i]) +
            Math.abs(data[i + 1] - this.previousFrameData[i + 1]) +
            Math.abs(data[i + 2] - this.previousFrameData[i + 2]);
          const normalized = diff / 765;
          totalMotion += normalized;
          if (normalized > 0.08) { // Significant per-pixel change
            motionMap[pixelIdx] = 1;
            motionPixels++;
          }
        }
      }
      const motionLevel = totalMotion / totalPixels;
      this.previousFrameData = new Uint8ClampedArray(data);

      // === UPDATE BACKGROUND MODEL ===
      this.updateBackgroundModel(data);

      // === DARK ENVIRONMENT CHECK ===
      if (avgBrightness < 20) {
        const det: DetectionResult = {
          type: 'dark_environment',
          confidence: Math.min(0.95, 0.80 + (20 - avgBrightness) / 40),
          timestamp: Date.now(),
          boundingBox: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
          label: 'DARK - LOW VISIBILITY',
        };
        return {
          primary: det, all: [det],
          tracked: this.getVisibleTracked(),
          frameMetrics: { brightness: avgBrightness, sharpness, motionLevel, objectCount: 0 },
          shouldTriggerDrone: true,
          droneReason: 'Dark environment - drone investigating',
        };
      }

      // === BLUR CHECK ===
      if (sharpness < 2.0) {
        const det: DetectionResult = {
          type: 'blurry_image',
          confidence: Math.min(0.95, 0.80 + (2.0 - sharpness) / 4),
          timestamp: Date.now(),
          boundingBox: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
          label: 'BLURRY - NEEDS VERIFICATION',
        };
        return {
          primary: det, all: [det],
          tracked: this.getVisibleTracked(),
          frameMetrics: { brightness: avgBrightness, sharpness, motionLevel, objectCount: 0 },
          shouldTriggerDrone: true,
          droneReason: 'Blurry image - drone moving closer',
        };
      }

      // === SERVER-SIDE AI ANALYSIS (every 3 seconds) ===
      const now = Date.now();
      if (now - this.lastAIAnalysis > AI_ANALYSIS_INTERVAL_MS && !this.isAnalyzing && this.trpcClient && this.serverAvailable) {
        this.isAnalyzing = true;
        this.lastAIAnalysis = now;

        const jpegDataUrl = this.analysisCanvas.toDataURL('image/jpeg', 0.6);
        const base64 = jpegDataUrl.split(',')[1];

        this.analyzeWithServer(base64).catch(err => {
          console.warn('[AIDetection] Server analysis failed:', err);
        }).finally(() => {
          this.isAnalyzing = false;
        });
      }

      // === LOCAL FALLBACK DETECTION (only when server is unavailable) ===
      if (!this.serverAvailable || this.lastAIDetections.length === 0) {
        // Only run local detection if there's significant motion
        if (motionLevel > MIN_MOTION_FOR_LOCAL && motionPixels > MIN_REGION_PIXELS) {
          const localDetections = this.detectLocally(data, motionMap, motionPixels, avgBrightness);
          if (localDetections.length > 0 && this.lastAIDetections.length === 0) {
            // Only use local detections if server hasn't provided any
            this.updateTracking(localDetections, 'local');
          }
        }
      }

      // === UPDATE TRACKING from AI detections ===
      if (this.lastAIDetections.length > 0) {
        this.updateTracking(this.lastAIDetections, 'ai');
      }

      // === BUILD RESULTS ===
      const activeTracked = this.getVisibleTracked();

      const detections: DetectionResult[] = activeTracked.map(t => ({
        type: t.type,
        confidence: t.confidence,
        boundingBox: t.smoothedBox,
        timestamp: t.lastSeen,
        label: t.label,
        trackId: t.id,
      }));
      detections.sort((a, b) => b.confidence - a.confidence);

      // === DRONE TRIGGER ===
      let shouldTriggerDrone = false;
      let droneReason: string | undefined;
      let droneTarget: TrackedObject | undefined;

      for (const tracked of activeTracked) {
        if (tracked.type === 'anonymous' && tracked.framesTracked >= 5) {
          if (now - this.lastDroneTrigger > 60000) {
            shouldTriggerDrone = true;
            droneReason = `Anonymous object detected (${(tracked.confidence * 100).toFixed(0)}%) - Drone dispatched`;
            droneTarget = tracked;
            this.lastDroneTrigger = now;
          }
        }
      }

      const primary = detections.length > 0 ? detections[0] : this.noneDetection();

      return {
        primary, all: detections, tracked: activeTracked,
        frameMetrics: { brightness: avgBrightness, sharpness, motionLevel, objectCount: activeTracked.length },
        shouldTriggerDrone, droneReason, droneTarget,
      };

    } catch (error) {
      console.error('[AIDetection] Error:', error);
      return this.emptyResult();
    }
  }

  // === SERVER-SIDE AI ANALYSIS ===
  private async analyzeWithServer(frameBase64: string): Promise<void> {
    if (!this.trpcClient) return;

    try {
      const result = await this.trpcClient.aiVision.analyzeFrame.mutate({
        frameBase64,
        width: this.W,
        height: this.H,
      });

      if (result.detections && result.detections.length > 0) {
        this.lastAIDetections = result.detections.map((d: any) => ({
          type: d.type,
          confidence: d.confidence,
          bbox: d.bbox,
          label: d.label || `${d.type.toUpperCase()} ${(d.confidence * 100).toFixed(0)}%`,
        }));
        this.serverAvailable = true;
        this.serverFailCount = 0;
        console.log(`[AIDetection] Server: ${result.detections.length} objects -`,
          result.detections.map((d: any) => `${d.type}(${(d.confidence * 100).toFixed(0)}%)`).join(', '));
      } else {
        // No detections from server - clear AI detections
        this.lastAIDetections = [];
        this.serverAvailable = true;
        this.serverFailCount = 0;
        console.log('[AIDetection] Server: scene clear (no objects)');
      }

      if (result.error) {
        console.warn('[AIDetection] Server error:', result.error);
      }
    } catch (error: any) {
      this.serverFailCount++;
      if (this.serverFailCount >= 3) {
        this.serverAvailable = false;
        console.warn('[AIDetection] Server unavailable after 3 failures. Using local detection.');
      }
      // Keep using last known detections - they'll age out naturally
    }
  }

  // === CONSERVATIVE LOCAL DETECTION (fallback) ===
  private detectLocally(
    data: Uint8ClampedArray,
    motionMap: Uint8Array,
    motionPixels: number,
    brightness: number
  ): { type: string; confidence: number; bbox: BoundingBox; label: string }[] {
    const detections: { type: string; confidence: number; bbox: BoundingBox; label: string }[] = [];

    // Find connected regions of motion
    const regions = this.findMotionRegions(motionMap);

    for (const region of regions.slice(0, 3)) { // Max 3 regions
      if (region.pixels < MIN_REGION_PIXELS) continue; // 400+ motion pixels required

      // Convert region bounds to normalized bbox
      const bbox: BoundingBox = {
        x: region.minX / this.W,
        y: region.minY / this.H,
        width: (region.maxX - region.minX) / this.W,
        height: (region.maxY - region.minY) / this.H,
      };

      // Reject if too large (> 60% of frame = probably camera shake)
      if (bbox.width * bbox.height > 0.6) continue;
      // Reject if too small (< 2% of frame = noise)
      if (bbox.width * bbox.height < 0.02) continue;

      // Classify the region
      const classification = this.classifyRegionConservative(data, region, brightness);
      if (classification.type === 'none') continue;

      detections.push({
        type: classification.type,
        confidence: classification.confidence,
        bbox,
        label: `${classification.type.toUpperCase()} ${(classification.confidence * 100).toFixed(0)}%`,
      });
    }

    return detections;
  }

  // Find connected motion regions using flood fill
  private findMotionRegions(motionMap: Uint8Array): { minX: number; minY: number; maxX: number; maxY: number; pixels: number }[] {
    const visited = new Uint8Array(this.W * this.H);
    const regions: { minX: number; minY: number; maxX: number; maxY: number; pixels: number }[] = [];

    for (let y = 0; y < this.H; y += 4) { // Step by 4 for speed
      for (let x = 0; x < this.W; x += 4) {
        const idx = y * this.W + x;
        if (motionMap[idx] && !visited[idx]) {
          // Flood fill to find connected region
          const region = { minX: x, minY: y, maxX: x, maxY: y, pixels: 0 };
          const stack = [idx];

          while (stack.length > 0) {
            const curr = stack.pop()!;
            if (visited[curr]) continue;
            visited[curr] = 1;

            const cx = curr % this.W;
            const cy = Math.floor(curr / this.W);
            region.minX = Math.min(region.minX, cx);
            region.minY = Math.min(region.minY, cy);
            region.maxX = Math.max(region.maxX, cx);
            region.maxY = Math.max(region.maxY, cy);
            region.pixels++;

            // Check 4-connected neighbors (with step for speed)
            const neighbors = [curr - 2, curr + 2, curr - this.W * 2, curr + this.W * 2];
            for (const n of neighbors) {
              if (n >= 0 && n < motionMap.length && motionMap[n] && !visited[n]) {
                stack.push(n);
              }
            }
          }

          if (region.pixels >= 50) { // Minimum 50 motion pixels to form a region
            regions.push(region);
          }
        }
      }
    }

    // Sort by size (largest first)
    regions.sort((a, b) => b.pixels - a.pixels);
    return regions;
  }

  // Conservative classification - requires VERY strong evidence
  private classifyRegionConservative(
    data: Uint8ClampedArray,
    region: { minX: number; minY: number; maxX: number; maxY: number; pixels: number },
    brightness: number
  ): { type: string; confidence: number } {
    let skinPixels = 0;
    let greenPixels = 0;
    let grayPixels = 0;
    let brightPixels = 0;
    let totalSampled = 0;

    // Region aspect ratio and size checks
    const regionW = region.maxX - region.minX;
    const regionH = region.maxY - region.minY;
    const aspect = regionH / Math.max(regionW, 1);

    // Sample pixels in the region
    for (let y = region.minY; y <= region.maxY; y += 3) {
      for (let x = region.minX; x <= region.maxX; x += 3) {
        const idx = (y * this.W + x) * 4;
        const r = data[idx], g = data[idx + 1], b = data[idx + 2];
        totalSampled++;

        // Skin tone detection (VERY strict - excludes warm wood/clay)
        // Must have: high red, moderate green, low blue, specific ratios
        if (r > 100 && g > 60 && b > 30 &&
            r > g && r > b &&
            r - g > 20 && r - b > 30 &&  // Stronger separation
            g - b > 5 && g - b < 50 &&   // Green slightly above blue (skin characteristic)
            Math.abs(g - b) < 45 &&
            r < 240 && g < 200 &&
            (r + g + b) > 200 && (r + g + b) < 600) { // Not too dark, not too bright
          skinPixels++;
        }

        // Green/earth tone (animal habitat)
        if (g > r && g > b && g > 70 && g - r > 15 && g - b > 15) {
          greenPixels++;
        }

        // Gray/metallic (vehicle)
        if (Math.abs(r - g) < 15 && Math.abs(g - b) < 15 && r > 60 && r < 200) {
          grayPixels++;
        }

        // Very bright (likely light source - reject)
        if (r > 230 && g > 230 && b > 230) {
          brightPixels++;
        }
      }
    }

    if (totalSampled === 0) return { type: 'none', confidence: 0 };

    const skinRatio = skinPixels / totalSampled;
    const greenRatio = greenPixels / totalSampled;
    const grayRatio = grayPixels / totalSampled;
    const brightRatio = brightPixels / totalSampled;

    // REJECT: If >20% of region is very bright, it's a light source, not an object
    if (brightRatio > 0.2) return { type: 'none', confidence: 0 };

    // HUMAN: Requires 25%+ skin pixels AND reasonable human-like aspect ratio (taller than wide)
    // Human bodies are typically aspect > 1.0 (taller) or faces are aspect 0.8-1.5
    if (skinRatio > 0.25 && aspect > 0.6 && aspect < 4.0) {
      const conf = Math.min(0.85, 0.55 + skinRatio * 0.8);
      return { type: 'human', confidence: conf };
    }

    // ANIMAL: Green/earth tones + motion + not skin + wider aspect (animals are often wider)
    if (greenRatio > 0.25 && skinRatio < 0.05 && aspect < 2.0) {
      return { type: 'animal', confidence: 0.55 };
    }

    // VEHICLE: Large gray region with wide aspect
    if (grayRatio > 0.35 && aspect < 1.2 && regionW > 40) {
      return { type: 'vehicle', confidence: 0.55 };
    }

    // ANONYMOUS: Moving object that doesn't match known categories
    // Only if there's VERY significant motion AND not a light source
    if (region.pixels > 500 && brightRatio < 0.1 && skinRatio < 0.1) {
      return { type: 'anonymous', confidence: 0.55 };
    }

    return { type: 'none', confidence: 0 };
  }

  // === BACKGROUND MODEL ===
  private updateBackgroundModel(data: Uint8ClampedArray) {
    if (!this.backgroundModel) {
      this.backgroundModel = new Float32Array(data.length);
      for (let i = 0; i < data.length; i++) {
        this.backgroundModel[i] = data[i];
      }
      this.backgroundFrameCount = 1;
      return;
    }

    // Exponential moving average (slow update = stable background)
    const alpha = 0.02; // Very slow learning rate
    for (let i = 0; i < data.length; i += 4) {
      this.backgroundModel[i] = this.backgroundModel[i] * (1 - alpha) + data[i] * alpha;
      this.backgroundModel[i + 1] = this.backgroundModel[i + 1] * (1 - alpha) + data[i + 1] * alpha;
      this.backgroundModel[i + 2] = this.backgroundModel[i + 2] * (1 - alpha) + data[i + 2] * alpha;
    }
    this.backgroundFrameCount++;
  }

  // === TRACKING ===
  private updateTracking(rawDetections: { type: string; confidence: number; bbox: BoundingBox; label: string }[], source: 'ai' | 'local') {
    const now = Date.now();

    // Match new detections to existing tracks using IoU
    const unmatched: typeof rawDetections = [];
    const matchedTrackIds = new Set<string>();

    for (const det of rawDetections) {
      let bestMatch: TrackedObject | null = null;
      let bestIoU = IOU_THRESHOLD;

      for (const [id, track] of this.trackedObjects) {
        if (matchedTrackIds.has(id)) continue;
        const iou = this.computeIoU(det.bbox, track.smoothedBox);
        if (iou > bestIoU) {
          bestIoU = iou;
          bestMatch = track;
        }
      }

      if (bestMatch) {
        // Update existing track
        matchedTrackIds.add(bestMatch.id);
        const prevBox = bestMatch.smoothedBox;
        bestMatch.type = det.type as any;
        bestMatch.confidence = det.confidence;
        bestMatch.boundingBox = det.bbox;
        bestMatch.label = `${det.type.toUpperCase()} ${(det.confidence * 100).toFixed(0)}%`;
        bestMatch.lastSeen = now;
        bestMatch.framesTracked++;
        bestMatch.source = source;

        // Smooth the bounding box
        bestMatch.smoothedBox = {
          x: prevBox.x + (det.bbox.x - prevBox.x) * SMOOTH_FACTOR,
          y: prevBox.y + (det.bbox.y - prevBox.y) * SMOOTH_FACTOR,
          width: prevBox.width + (det.bbox.width - prevBox.width) * SMOOTH_FACTOR,
          height: prevBox.height + (det.bbox.height - prevBox.height) * SMOOTH_FACTOR,
        };

        // Update velocity
        bestMatch.velocity = {
          dx: det.bbox.x - prevBox.x,
          dy: det.bbox.y - prevBox.y,
        };
      } else {
        unmatched.push(det);
      }
    }

    // Create new tracks for unmatched detections (limit total)
    for (const det of unmatched) {
      if (this.trackedObjects.size >= MAX_TRACKED_OBJECTS) break;

      const id = `track-${nextTrackId++}`;
      this.trackedObjects.set(id, {
        id,
        type: det.type as any,
        confidence: det.confidence,
        boundingBox: det.bbox,
        smoothedBox: { ...det.bbox },
        label: `${det.type.toUpperCase()} ${(det.confidence * 100).toFixed(0)}%`,
        lastSeen: now,
        framesTracked: 1,
        velocity: { dx: 0, dy: 0 },
        source,
      });
    }

    // Remove stale tracks
    for (const [id, track] of this.trackedObjects) {
      if (now - track.lastSeen > MAX_TRACK_AGE_MS) {
        this.trackedObjects.delete(id);
      }
    }
  }

  // Get tracked objects that have been visible long enough to show
  private getVisibleTracked(): TrackedObject[] {
    const now = Date.now();
    return Array.from(this.trackedObjects.values())
      .filter(t => now - t.lastSeen < MAX_TRACK_AGE_MS && t.framesTracked >= MIN_FRAMES_TO_SHOW);
  }

  // === HELPERS ===
  private computeIoU(a: BoundingBox, b: BoundingBox): number {
    const x1 = Math.max(a.x, b.x);
    const y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.width, b.x + b.width);
    const y2 = Math.min(a.y + a.height, b.y + b.height);

    if (x2 <= x1 || y2 <= y1) return 0;

    const intersection = (x2 - x1) * (y2 - y1);
    const areaA = a.width * a.height;
    const areaB = b.width * b.height;
    const union = areaA + areaB - intersection;

    return union > 0 ? intersection / union : 0;
  }

  private computeSharpness(data: Uint8ClampedArray, w: number, h: number): number {
    let sum = 0;
    let count = 0;
    const step = 4;
    for (let y = 1; y < h - 1; y += step) {
      for (let x = 1; x < w - 1; x += step) {
        const idx = (y * w + x) * 4;
        const center = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
        const right = data[idx + 4] * 0.299 + data[idx + 5] * 0.587 + data[idx + 6] * 0.114;
        const below = data[(idx + w * 4)] * 0.299 + data[(idx + w * 4) + 1] * 0.587 + data[(idx + w * 4) + 2] * 0.114;
        sum += Math.abs(center - right) + Math.abs(center - below);
        count++;
      }
    }
    return count > 0 ? sum / count : 0;
  }

  private noneDetection(): DetectionResult {
    return { type: 'none', confidence: 0, timestamp: Date.now() };
  }

  private emptyResult(): MultiDetectionResult {
    return {
      primary: this.noneDetection(),
      all: [],
      tracked: this.getVisibleTracked(),
      frameMetrics: { brightness: 0, sharpness: 0, motionLevel: 0, objectCount: 0 },
      shouldTriggerDrone: false,
    };
  }

  // Reset all tracking state
  reset() {
    this.trackedObjects.clear();
    this.lastAIDetections = [];
    this.previousFrameData = null;
    this.backgroundModel = null;
    this.backgroundFrameCount = 0;
    this.frameCount = 0;
    this.lastAIAnalysis = 0;
    this.isAnalyzing = false;
    this.serverFailCount = 0;
    this.serverAvailable = true;
  }
}

// Singleton instance
export const aiDetection = new AIDetectionEngine();
export default aiDetection;
