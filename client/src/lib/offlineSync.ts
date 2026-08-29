/**
 * Offline sync manager with queue management, auto-retry logic, and ETA calculation
 */

import { indexedDB, SyncQueueItem } from './indexeddb';

export interface SyncStatus {
  isOnline: boolean;
  queueSize: number;
  estimatedETA: number; // milliseconds
  lastSyncTime?: number;
  syncInProgress: boolean;
}

class OfflineSyncManager {
  private syncStatus: SyncStatus = {
    isOnline: navigator.onLine,
    queueSize: 0,
    estimatedETA: 0,
    syncInProgress: false,
  };

  private syncInterval: NodeJS.Timeout | null = null;
  private retryInterval = 30000; // 30 seconds
  private maxRetries = 5;
  private maxQueueSize = 1000;
  private listeners: Set<(status: SyncStatus) => void> = new Set();

  constructor() {
    this.init();
  }

  private async init(): Promise<void> {
    // Listen for online/offline events
    window.addEventListener('online', () => this.handleOnline());
    window.addEventListener('offline', () => this.handleOffline());

    // Initialize sync status
    await this.updateSyncStatus();

    // Start periodic sync if online
    if (this.syncStatus.isOnline) {
      this.startPeriodicSync();
    }
  }

  private handleOnline(): void {
    this.syncStatus.isOnline = true;
    this.notifyListeners();
    this.startPeriodicSync();
    this.sync();
  }

  private handleOffline(): void {
    this.syncStatus.isOnline = false;
    this.notifyListeners();
    this.stopPeriodicSync();
  }

  private startPeriodicSync(): void {
    if (this.syncInterval) return;
    this.syncInterval = setInterval(() => this.sync(), this.retryInterval);
  }

  private stopPeriodicSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  async addToQueue(type: 'detection' | 'alert' | 'status', data: unknown): Promise<void> {
    const queueSize = await indexedDB.getSyncQueueSize();
    if (queueSize >= this.maxQueueSize) {
      throw new Error('Sync queue is full. Please try again later.');
    }

    const item: SyncQueueItem = {
      id: `${type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type,
      data,
      timestamp: Date.now(),
      retries: 0,
    };

    await indexedDB.addToSyncQueue(item);
    await this.updateSyncStatus();
    this.notifyListeners();

    // Try to sync immediately if online
    if (this.syncStatus.isOnline) {
      this.sync();
    }
  }

  async sync(): Promise<void> {
    if (!this.syncStatus.isOnline || this.syncStatus.syncInProgress) {
      return;
    }

    this.syncStatus.syncInProgress = true;
    this.notifyListeners();

    try {
      const queue = await indexedDB.getSyncQueue();
      if (queue.length === 0) {
        this.syncStatus.lastSyncTime = Date.now();
        this.syncStatus.syncInProgress = false;
        this.notifyListeners();
        return;
      }

      // Batch sync items
      const itemsToSync = queue.slice(0, 100); // Process in batches of 100
      const response = await fetch('/api/trpc/sync.push?batch=1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          '0': {
            items: itemsToSync
          }
        }),
      });

      if (!response.ok) {
        throw new Error(`Sync failed with status ${response.status}`);
      }

      const json = await response.json();
      const result = json[0]?.result?.data;

      if (!result) {
        throw new Error('Invalid sync response format');
      }

      // Remove synced items from queue
      for (const item of itemsToSync) {
        if (result.synced?.includes(item.id)) {
          await indexedDB.removeSyncQueueItem(item.id);
        } else {
          // Increment retry count
          item.retries++;
          item.lastRetryTime = Date.now();

          if (item.retries >= this.maxRetries) {
            // Remove item after max retries
            await indexedDB.removeSyncQueueItem(item.id);
          }
        }
      }

      this.syncStatus.lastSyncTime = Date.now();
      await this.updateSyncStatus();
    } catch (error) {
      console.error('Sync error:', error);
      // Don't update status on error, will retry on next interval
    } finally {
      this.syncStatus.syncInProgress = false;
      this.notifyListeners();
    }
  }

  private async updateSyncStatus(): Promise<void> {
    const queueSize = await indexedDB.getSyncQueueSize();
    this.syncStatus.queueSize = queueSize;

    // Calculate ETA based on queue size and sync interval
    // Assuming ~10 items per sync cycle
    const estimatedCycles = Math.ceil(queueSize / 10);
    this.syncStatus.estimatedETA = estimatedCycles * this.retryInterval;
  }

  getStatus(): SyncStatus {
    return { ...this.syncStatus };
  }

  subscribe(listener: (status: SyncStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    const status = this.getStatus();
    this.listeners.forEach((listener) => listener(status));
  }

  async clearQueue(): Promise<void> {
    const queue = await indexedDB.getSyncQueue();
    for (const item of queue) {
      await indexedDB.removeSyncQueueItem(item.id);
    }
    await this.updateSyncStatus();
    this.notifyListeners();
  }

  async getQueueDetails(): Promise<SyncQueueItem[]> {
    return indexedDB.getSyncQueue();
  }

  setRetryInterval(interval: number): void {
    this.retryInterval = interval;
    if (this.syncInterval) {
      this.stopPeriodicSync();
      this.startPeriodicSync();
    }
  }

  setMaxQueueSize(size: number): void {
    this.maxQueueSize = size;
  }
}

export const offlineSync = new OfflineSyncManager();
