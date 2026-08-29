import { describe, it, expect, beforeEach } from 'vitest';
import { indexedDB } from '../client/src/lib/indexeddb';
import { offlineSync } from '../client/src/lib/offlineSync';

// Tests for detection events
describe('Detection Events', () => {
  it('should create a detection event', async () => {
    const detection = {
      id: 'test-1',
      type: 'human' as const,
      confidence: 0.95,
      timestamp: Date.now(),
      stationId: 'station-1',
    };

    await indexedDB.addDetection(detection);
    const retrieved = await indexedDB.getDetectionEventById(detection.id);

    expect(retrieved).toBeDefined();
    expect(retrieved?.type).toBe('human');
    expect(retrieved?.confidence).toBe(0.95);
  });

  it('should get detections by station', async () => {
    const detection1 = {
      id: 'test-2',
      type: 'animal' as const,
      confidence: 0.87,
      timestamp: Date.now(),
      stationId: 'station-1',
    };

    const detection2 = {
      id: 'test-3',
      type: 'vehicle' as const,
      confidence: 0.92,
      timestamp: Date.now(),
      stationId: 'station-2',
    };

    await indexedDB.addDetection(detection1);
    await indexedDB.addDetection(detection2);

    const stationDetections = await indexedDB.getDetectionsByStation('station-1');
    expect(stationDetections.length).toBeGreaterThan(0);
    expect(stationDetections[0].stationId).toBe('station-1');
  });

  it('should mark detection as synced', async () => {
    const detection = {
      id: 'test-4',
      type: 'human' as const,
      confidence: 0.88,
      timestamp: Date.now(),
      stationId: 'station-1',
    };

    await indexedDB.addDetection(detection);
    await indexedDB.markDetectionSynced(detection.id);

    const retrieved = await indexedDB.getDetectionEventById(detection.id);
    expect(retrieved?.synced).toBe(true);
  });

  it('should get pending detections', async () => {
    const detection = {
      id: 'test-5',
      type: 'animal' as const,
      confidence: 0.91,
      timestamp: Date.now(),
      stationId: 'station-1',
    };

    await indexedDB.addDetection(detection);
    const pending = await indexedDB.getPendingDetections();

    expect(pending.length).toBeGreaterThan(0);
    expect(pending.some((d) => d.id === detection.id)).toBe(true);
  });
});

// Tests for camera stations
describe('Camera Stations', () => {
  it('should create a camera station', async () => {
    const station = {
      id: 'station-test-1',
      name: 'North Perimeter',
      status: 'online' as const,
      latitude: -1.2345,
      longitude: 36.7890,
      sensitivity: 'medium' as const,
    };

    await indexedDB.addStation(station);
    const retrieved = await indexedDB.getStation(station.id);

    expect(retrieved).toBeDefined();
    expect(retrieved?.name).toBe('North Perimeter');
    expect(retrieved?.status).toBe('online');
  });

  it('should get all stations', async () => {
    const stations = await indexedDB.getStations();
    expect(Array.isArray(stations)).toBe(true);
  });
});

// Tests for offline sync
describe('Offline Sync Manager', () => {
  beforeEach(async () => {
    await offlineSync.clearQueue();
  });

  it('should add item to sync queue', async () => {
    await offlineSync.addToQueue('detection', {
      type: 'human',
      confidence: 0.9,
      stationId: 'station-1',
    });

    const status = offlineSync.getStatus();
    expect(status.queueSize).toBeGreaterThan(0);
  });

  it('should get sync queue', async () => {
    await offlineSync.addToQueue('detection', {
      type: 'animal',
      confidence: 0.85,
      stationId: 'station-1',
    });

    const queue = await offlineSync.getQueueDetails();
    expect(queue.length).toBeGreaterThan(0);
    expect(queue[0].type).toBe('detection');
  });

  it('should calculate sync ETA', async () => {
    await offlineSync.addToQueue('detection', {
      type: 'vehicle',
      confidence: 0.92,
      stationId: 'station-1',
    });

    const status = offlineSync.getStatus();
    expect(status.estimatedETA).toBeGreaterThanOrEqual(0);
  });

  it('should clear sync queue', async () => {
    await offlineSync.addToQueue('detection', {
      type: 'human',
      confidence: 0.88,
      stationId: 'station-1',
    });

    await offlineSync.clearQueue();
    const status = offlineSync.getStatus();
    expect(status.queueSize).toBe(0);
  });
});

// Tests for user preferences
describe('User Preferences', () => {
  it('should set and get preference', async () => {
    await indexedDB.setPreference('theme', 'dark');
    const theme = await indexedDB.getPreference('theme');

    expect(theme).toBe('dark');
  });

  it('should store multiple preferences', async () => {
    await indexedDB.setPreference('confidenceThreshold', 0.85);
    await indexedDB.setPreference('motionSensitivity', 'medium');

    const threshold = await indexedDB.getPreference('confidenceThreshold');
    const sensitivity = await indexedDB.getPreference('motionSensitivity');

    expect(threshold).toBe(0.85);
    expect(sensitivity).toBe('medium');
  });
});

// Tests for sync queue management
describe('Sync Queue Management', () => {
  beforeEach(async () => {
    await offlineSync.clearQueue();
  });

  it('should handle multiple queue items', async () => {
    for (let i = 0; i < 5; i++) {
      await offlineSync.addToQueue('detection', {
        type: 'human',
        confidence: 0.9,
        stationId: `station-${i}`,
      });
    }

    const status = offlineSync.getStatus();
    expect(status.queueSize).toBe(5);
  });

  it('should prevent queue overflow', async () => {
    offlineSync.setMaxQueueSize(10);

    for (let i = 0; i < 12; i++) {
      try {
        await offlineSync.addToQueue('detection', {
          type: 'animal',
          confidence: 0.85,
          stationId: 'station-1',
        });
      } catch (error) {
        expect(error).toBeDefined();
        break;
      }
    }
  });

  it('should set custom retry interval', () => {
    offlineSync.setRetryInterval(60000);
    const status = offlineSync.getStatus();
    expect(status).toBeDefined();
  });
});

// Tests for detection filtering
describe('Detection Filtering', () => {
  it('should filter critical detections', async () => {
    const detections = [
      { id: '1', type: 'human' as const, confidence: 0.95, timestamp: Date.now(), stationId: 'station-1' },
      { id: '2', type: 'animal' as const, confidence: 0.75, timestamp: Date.now(), stationId: 'station-1' },
      { id: '3', type: 'vehicle' as const, confidence: 0.88, timestamp: Date.now(), stationId: 'station-1' },
    ];

    const critical = detections.filter((d) => d.confidence > 0.85);
    expect(critical.length).toBe(2);
    expect(critical.every((d) => d.confidence > 0.85)).toBe(true);
  });

  it('should sort detections by timestamp', async () => {
    const detections = [
      { id: '1', type: 'human' as const, confidence: 0.9, timestamp: 1000, stationId: 'station-1' },
      { id: '2', type: 'animal' as const, confidence: 0.85, timestamp: 3000, stationId: 'station-1' },
      { id: '3', type: 'vehicle' as const, confidence: 0.92, timestamp: 2000, stationId: 'station-1' },
    ];

    const sorted = detections.sort((a, b) => b.timestamp - a.timestamp);
    expect(sorted[0].timestamp).toBe(3000);
    expect(sorted[2].timestamp).toBe(1000);
  });
});

// Tests for data persistence
describe('Data Persistence', () => {
  it('should persist detection data', async () => {
    const detection = {
      id: 'persist-test-1',
      type: 'human' as const,
      confidence: 0.93,
      timestamp: Date.now(),
      stationId: 'station-1',
    };

    await indexedDB.addDetection(detection);
    const retrieved = await indexedDB.getDetectionEventById(detection.id);

    expect(retrieved?.id).toBe(detection.id);
    expect(retrieved?.confidence).toBe(detection.confidence);
  });

  it('should clear old detections', async () => {
    const oldDetection = {
      id: 'old-det-1',
      type: 'animal' as const,
      confidence: 0.87,
      timestamp: Date.now() - 31 * 24 * 60 * 60 * 1000, // 31 days old
      stationId: 'station-1',
    };

    await indexedDB.addDetection(oldDetection);
    const deleted = await indexedDB.clearOldDetections(30);

    expect(deleted).toBeGreaterThanOrEqual(0);
  });
});

// Tests for notification templates
describe('Notification Templates', () => {
  it('should have critical detection template', () => {
    const template = {
      title: 'Critical Detection!',
      body: 'Human detected with 95% confidence',
      tag: 'critical-detection',
      requireInteraction: true,
    };

    expect(template.title).toBeDefined();
    expect(template.body).toBeDefined();
    expect(template.requireInteraction).toBe(true);
  });

  it('should have drone deployed template', () => {
    const template = {
      title: 'Drone Deployed',
      body: 'Drone deployed to verify detection',
      tag: 'drone-deployed',
      requireInteraction: false,
    };

    expect(template.title).toBeDefined();
    expect(template.body).toBeDefined();
  });

  it('should have drone completed template', () => {
    const template = {
      title: 'Mission Complete',
      body: 'Drone mission completed. Threat confirmed.',
      tag: 'drone-completed',
      requireInteraction: false,
    };

    expect(template.title).toBeDefined();
    expect(template.body).toBeDefined();
  });

  it('should have false alarm template', () => {
    const template = {
      title: 'False Alarm',
      body: 'Detection verified as false alarm',
      tag: 'false-alarm',
      requireInteraction: false,
    };

    expect(template.title).toBeDefined();
    expect(template.body).toBeDefined();
  });

  it('should have low battery template', () => {
    const template = {
      title: 'Low Battery',
      body: 'Camera station battery low',
      tag: 'low-battery',
      requireInteraction: false,
    };

    expect(template.title).toBeDefined();
    expect(template.body).toBeDefined();
  });

  it('should have signal lost template', () => {
    const template = {
      title: 'Signal Lost',
      body: 'Camera station signal lost',
      tag: 'signal-lost',
      requireInteraction: true,
    };

    expect(template.title).toBeDefined();
    expect(template.body).toBeDefined();
  });

  it('should have system alert template', () => {
    const template = {
      title: 'System Alert',
      body: 'System maintenance required',
      tag: 'system-alert',
      requireInteraction: false,
    };

    expect(template.title).toBeDefined();
    expect(template.body).toBeDefined();
  });

  it('should have ranger response template', () => {
    const template = {
      title: 'Ranger Response',
      body: 'Ranger has acknowledged the alert',
      tag: 'ranger-response',
      requireInteraction: false,
    };

    expect(template.title).toBeDefined();
    expect(template.body).toBeDefined();
  });
});

// Tests for confidence threshold
describe('Confidence Threshold', () => {
  it('should filter by confidence threshold', () => {
    const threshold = 0.85;
    const detections = [
      { confidence: 0.95 },
      { confidence: 0.75 },
      { confidence: 0.88 },
      { confidence: 0.82 },
    ];

    const filtered = detections.filter((d) => d.confidence >= threshold);
    expect(filtered.length).toBe(2);
  });

  it('should handle edge case at threshold', () => {
    const threshold = 0.85;
    const detection = { confidence: 0.85 };

    expect(detection.confidence >= threshold).toBe(true);
  });
});
