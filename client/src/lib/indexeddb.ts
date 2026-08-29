/**
 * IndexedDB utilities for offline-first architecture
 * Provides local storage with automatic cloud sync capabilities
 */

export interface DetectionEvent {
  id: string;
  type: 'human' | 'animal' | 'vehicle' | 'anonymous' | 'dark_environment' | 'blurry_image';
  confidence: number;
  timestamp: number;
  stationId: string;
  imageUrl?: string;
  imageData?: string; // base64 for offline storage
  latitude?: number;
  longitude?: number;
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  synced?: boolean;
  syncedAt?: number;
}

export interface CameraStation {
  id: string;
  name: string;
  status: 'online' | 'offline' | 'error';
  latitude: number;
  longitude: number;
  lastDetectionTime?: number;
  sensitivity: 'low' | 'medium' | 'high';
}

export interface SyncQueueItem {
  id: string;
  type: 'detection' | 'alert' | 'status';
  data: unknown;
  timestamp: number;
  retries: number;
  lastRetryTime?: number;
}

class IndexedDBManager {
  private db: IDBDatabase | null = null;
  private dbName = 'WildlifeConservationDB';
  private version = 1;

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = window.indexedDB.open(this.dbName, this.version);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create object stores
        if (!db.objectStoreNames.contains('detections')) {
          const detectionStore = db.createObjectStore('detections', { keyPath: 'id' });
          detectionStore.createIndex('timestamp', 'timestamp', { unique: false });
          detectionStore.createIndex('stationId', 'stationId', { unique: false });
          detectionStore.createIndex('synced', 'synced', { unique: false });
        }

        if (!db.objectStoreNames.contains('stations')) {
          const stationStore = db.createObjectStore('stations', { keyPath: 'id' });
          stationStore.createIndex('status', 'status', { unique: false });
        }

        if (!db.objectStoreNames.contains('syncQueue')) {
          const syncStore = db.createObjectStore('syncQueue', { keyPath: 'id' });
          syncStore.createIndex('timestamp', 'timestamp', { unique: false });
          syncStore.createIndex('type', 'type', { unique: false });
        }

        if (!db.objectStoreNames.contains('userPreferences')) {
          db.createObjectStore('userPreferences', { keyPath: 'key' });
        }
      };
    });
  }

  // Detection operations
  async addDetection(detection: DetectionEvent): Promise<void> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['detections'], 'readwrite');
      const store = transaction.objectStore('detections');
      const request = store.add({ ...detection, synced: false });
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async getDetections(limit = 100, offset = 0): Promise<DetectionEvent[]> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['detections'], 'readonly');
      const store = transaction.objectStore('detections');
      const index = store.index('timestamp');
      const request = index.openCursor(null, 'prev');
      const results: DetectionEvent[] = [];
      let count = 0;

      request.onerror = () => reject(request.error);
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
        if (cursor && count < offset + limit) {
          if (count >= offset) {
            results.push(cursor.value);
          }
          count++;
          cursor.continue();
        } else {
          resolve(results);
        }
      };
    });
  }

  async getDetectionsByStation(stationId: string): Promise<DetectionEvent[]> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['detections'], 'readonly');
      const store = transaction.objectStore('detections');
      const index = store.index('stationId');
      const request = index.getAll(stationId);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  async getPendingDetections(): Promise<DetectionEvent[]> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['detections'], 'readonly');
      const store = transaction.objectStore('detections');
      const request = store.getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const allDetections = request.result || [];
        const pending = allDetections.filter((d: DetectionEvent) => !d.synced);
        resolve(pending);
      };
    });
  }

  async markDetectionSynced(detectionId: string): Promise<void> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['detections'], 'readwrite');
      const store = transaction.objectStore('detections');
      const request = store.get(detectionId);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const detection = request.result;
        if (detection) {
          detection.synced = true;
          detection.syncedAt = Date.now();
          const updateRequest = store.put(detection);
          updateRequest.onerror = () => reject(updateRequest.error);
          updateRequest.onsuccess = () => resolve();
        } else {
          resolve();
        }
      };
    });
  }

  async clearOldDetections(daysOld = 30): Promise<number> {
    if (!this.db) await this.init();
    const cutoffTime = Date.now() - daysOld * 24 * 60 * 60 * 1000;
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['detections'], 'readwrite');
      const store = transaction.objectStore('detections');
      const index = store.index('timestamp');
      const range = window.IDBKeyRange.upperBound(cutoffTime);
      const request = index.openCursor(range);
      let deleted = 0;

      request.onerror = () => reject(request.error);
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
        if (cursor) {
          cursor.delete();
          deleted++;
          cursor.continue();
        } else {
          resolve(deleted);
        }
      };
    });
  }

  // Station operations
  async addStation(station: CameraStation): Promise<void> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['stations'], 'readwrite');
      const store = transaction.objectStore('stations');
      const request = store.put(station);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async getStations(): Promise<CameraStation[]> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['stations'], 'readonly');
      const store = transaction.objectStore('stations');
      const request = store.getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  async getStation(stationId: string): Promise<CameraStation | undefined> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['stations'], 'readonly');
      const store = transaction.objectStore('stations');
      const request = store.get(stationId);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  // Sync queue operations
  async addToSyncQueue(item: SyncQueueItem): Promise<void> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['syncQueue'], 'readwrite');
      const store = transaction.objectStore('syncQueue');
      const request = store.add(item);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async getSyncQueue(): Promise<SyncQueueItem[]> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['syncQueue'], 'readonly');
      const store = transaction.objectStore('syncQueue');
      const request = store.getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  async removeSyncQueueItem(itemId: string): Promise<void> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['syncQueue'], 'readwrite');
      const store = transaction.objectStore('syncQueue');
      const request = store.delete(itemId);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async getSyncQueueSize(): Promise<number> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['syncQueue'], 'readonly');
      const store = transaction.objectStore('syncQueue');
      const request = store.count();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  // User preferences
  async setPreference(key: string, value: unknown): Promise<void> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['userPreferences'], 'readwrite');
      const store = transaction.objectStore('userPreferences');
      const request = store.put({ key, value });
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async getPreference(key: string): Promise<unknown> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['userPreferences'], 'readonly');
      const store = transaction.objectStore('userPreferences');
      const request = store.get(key);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result?.value);
    });
  }

  async clearAllData(): Promise<void> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['detections', 'stations', 'syncQueue', 'userPreferences'], 'readwrite');
      const stores = ['detections', 'stations', 'syncQueue', 'userPreferences'];
      let completed = 0;

      stores.forEach((storeName) => {
        const store = transaction.objectStore(storeName);
        const request = store.clear();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          completed++;
          if (completed === stores.length) resolve();
        };
      });
    });
  }
}

export const indexedDB = new IndexedDBManager();
