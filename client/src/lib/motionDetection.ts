/**
 * Motion detection engine using frame differencing
 * Triggers AI inference only when significant motion is detected
 */

export interface MotionDetectionConfig {
  sensitivity: 'low' | 'medium' | 'high';
  frameInterval: number; // milliseconds between frames
  pixelThreshold: number; // 0-255, pixel difference threshold
  motionThreshold: number; // percentage of pixels that must differ
}

export interface MotionDetectionResult {
  motionDetected: boolean;
  motionPercentage: number;
  timestamp: number;
}

class MotionDetectionEngine {
  private canvas: OffscreenCanvas | null = null;
  private ctx: OffscreenCanvasRenderingContext2D | null = null;
  private previousFrame: ImageData | null = null;
  private config: MotionDetectionConfig;
  private isRunning = false;
  private listeners: Set<(result: MotionDetectionResult) => void> = new Set();

  constructor(config: Partial<MotionDetectionConfig> = {}) {
    this.config = {
      sensitivity: config.sensitivity || 'high',
      frameInterval: config.frameInterval || 100,
      pixelThreshold: config.pixelThreshold || 20,
      motionThreshold: this.getSensitivityThreshold(config.sensitivity || 'high'),
    };

    // Try to use OffscreenCanvas if available, fallback to regular canvas
    if (typeof OffscreenCanvas !== 'undefined') {
      this.canvas = new OffscreenCanvas(640, 480);
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true }) as any;
    } else if (typeof document !== 'undefined') {
      const fallbackCanvas = document.createElement('canvas') as any;
      fallbackCanvas.width = 640;
      fallbackCanvas.height = 480;
      this.canvas = fallbackCanvas;
      this.ctx = fallbackCanvas.getContext('2d', { willReadFrequently: true });
    }
  }

  private getSensitivityThreshold(sensitivity: 'low' | 'medium' | 'high'): number {
    switch (sensitivity) {
      case 'low':
        return 10; // 10% of pixels must differ
      case 'medium':
        return 5; // 5% of pixels must differ
      case 'high':
        return 2; // 2% of pixels must differ
      default:
        return 5;
    }
  }

  async processFrame(videoElement: HTMLVideoElement): Promise<MotionDetectionResult> {
    if (!this.ctx || !this.canvas) {
      return {
        motionDetected: false,
        motionPercentage: 0,
        timestamp: Date.now(),
      };
    }

    try {
      // Draw current frame to canvas
      this.ctx.drawImage(videoElement, 0, 0, this.canvas.width, this.canvas.height);
      const currentFrame = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);

      // Calculate motion if we have a previous frame
      if (!this.previousFrame) {
        this.previousFrame = currentFrame;
        return {
          motionDetected: false,
          motionPercentage: 0,
          timestamp: Date.now(),
        };
      }

      const motionPercentage = this.calculateMotion(this.previousFrame, currentFrame);
      const motionDetected = motionPercentage > this.config.motionThreshold;

      // Store current frame for next comparison
      this.previousFrame = currentFrame;

      const result: MotionDetectionResult = {
        motionDetected,
        motionPercentage,
        timestamp: Date.now(),
      };

      return result;
    } catch (error) {
      console.error('Motion detection error:', error);
      return {
        motionDetected: false,
        motionPercentage: 0,
        timestamp: Date.now(),
      };
    }
  }

  private calculateMotion(frame1: ImageData, frame2: ImageData): number {
    const data1 = frame1.data;
    const data2 = frame2.data;
    let diffPixels = 0;

    // Compare pixel values
    for (let i = 0; i < data1.length; i += 4) {
      const r1 = data1[i];
      const g1 = data1[i + 1];
      const b1 = data1[i + 2];

      const r2 = data2[i];
      const g2 = data2[i + 1];
      const b2 = data2[i + 2];

      // Calculate pixel difference
      const diff = Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);

      if (diff > this.config.pixelThreshold) {
        diffPixels++;
      }
    }

    // Calculate percentage of changed pixels
    const totalPixels = data1.length / 4;
    return (diffPixels / totalPixels) * 100;
  }

  start(videoElement: HTMLVideoElement, onMotion?: (result: MotionDetectionResult) => void): void {
    if (this.isRunning) return;

    this.isRunning = true;
    if (onMotion) {
      this.listeners.add(onMotion);
    }

    const processFrame = async () => {
      if (!this.isRunning) return;

      try {
        const result = await this.processFrame(videoElement);
        this.notifyListeners(result);

        if (result.motionDetected) {
          // Process more frequently when motion is detected
          setTimeout(processFrame, this.config.frameInterval / 2);
        } else {
          setTimeout(processFrame, this.config.frameInterval);
        }
      } catch (error) {
        console.error('Motion detection processing error:', error);
        setTimeout(processFrame, this.config.frameInterval);
      }
    };

    processFrame();
  }

  stop(): void {
    this.isRunning = false;
    this.previousFrame = null;
  }

  setSensitivity(sensitivity: 'low' | 'medium' | 'high'): void {
    this.config.sensitivity = sensitivity;
    this.config.motionThreshold = this.getSensitivityThreshold(sensitivity);
  }

  setFrameInterval(interval: number): void {
    this.config.frameInterval = interval;
  }

  subscribe(listener: (result: MotionDetectionResult) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(result: MotionDetectionResult): void {
    this.listeners.forEach((listener) => listener(result));
  }

  isActive(): boolean {
    return this.isRunning;
  }
}

export const motionDetection = new MotionDetectionEngine();
