/**
 * tRPC router for offline sync and batch persistence
 */

import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { createDetectionEvent, createAlert, createAlertLog } from "../db";
import { nanoid } from "nanoid";

interface SyncItem {
  id: string;
  type: "detection" | "alert" | "status";
  data: unknown;
  timestamp: number;
}

// Track synced items to prevent duplicates
const syncedItems = new Set<string>();

export const syncRouter = router({
  // Batch sync endpoint for offline-first architecture
  push: publicProcedure
    .input(
      z.object({
        items: z.array(
          z.object({
            id: z.string(),
            type: z.enum(["detection", "alert", "status"]),
            data: z.unknown(),
            timestamp: z.number(),
          })
        ),
      })
    )
    .mutation(async ({ input }) => {
      const synced: string[] = [];
      const failed: string[] = [];

      for (const item of input.items) {
        try {
          // Check for duplicates
          if (syncedItems.has(item.id)) {
            synced.push(item.id);
            continue;
          }

          switch (item.type) {
            case "detection": {
              const detectionData = item.data as any;
              const detection = await createDetectionEvent({
                id: detectionData.id || nanoid(),
                type: (detectionData.type === 'anonymous' || detectionData.type === 'dark_environment' || detectionData.type === 'blurry_image') ? 'anonymous' : detectionData.type,
                confidence: detectionData.confidence,
                stationId: detectionData.stationId,
                imageUrl: detectionData.imageUrl,
                imageData: detectionData.imageData,
                latitude: detectionData.latitude,
                longitude: detectionData.longitude,
                boundingBox: detectionData.boundingBox ? JSON.stringify(detectionData.boundingBox) : null,
                timestamp: new Date(item.timestamp),
                verificationStatus: "pending",
              });

              // AUTO-TRIGGER DRONE MISSION during sync ONLY if anonymous_image, dark_environment, or blurry_image
              // With 5-minute per-station cooldown to prevent mission spam
              if (detectionData.type === 'anonymous' || detectionData.type === 'dark_environment' || detectionData.type === 'blurry_image') {
                try {
                  const { getCameraStationById, createDroneMission, hasRecentDroneMission } = await import("../db");

                  // CHECK COOLDOWN: Skip if a mission was already created for this station in the last 5 minutes
                  const recentMissionExists = await hasRecentDroneMission(detectionData.stationId, 300000);
                  if (recentMissionExists) {
                    console.log(`[Sync] Skipping drone trigger - recent mission exists for station ${detectionData.stationId}`);
                    synced.push(item.id);
                    syncedItems.add(item.id);
                    break;
                  }

                  const station = await getCameraStationById(detectionData.stationId);
                  
                  // For anonymous detections, we try to assign an available drone immediately
                  let droneId: string | null = null;
                  let status: 'pending' | 'launched' = 'pending';
                  let launchedAt: Date | null = null;

                  if (detectionData.type === 'anonymous' || detectionData.type === 'dark_environment' || detectionData.type === 'blurry_image') {
                    droneId = `drone-auto-${nanoid(4)}`;
                    status = 'launched';
                    launchedAt = new Date();
                    console.log(`[Sync] Anonymous detection: Auto-assigning drone ${droneId}`);
                  }

                  await createDroneMission({
                    id: nanoid(),
                    detectionEventId: detection.id,
                    droneId,
                    status,
                    targetLatitude: detectionData.latitude?.toString() || station?.latitude.toString() || '0',
                    targetLongitude: detectionData.longitude?.toString() || station?.longitude.toString() || '0',
                    verificationResult: null,
                    footageUrl: null,
                    createdAt: new Date(),
                    launchedAt,
                    completedAt: null,
                    updatedAt: new Date(),
                  });
                  console.log(`[Sync] Auto-triggered drone mission (${status}) for synced detection ${detection.id}`);
                } catch (err) {
                  console.error('[Sync] Failed to auto-trigger drone mission:', err);
                }
              }

              synced.push(item.id);
              syncedItems.add(item.id);
              break;
            }

            case "alert": {
              const alertData = item.data as any;
              await createAlert({
                id: nanoid(),
                alertType: alertData.alertType,
                recipientId: alertData.recipientId,
                status: "sent",
                channel: alertData.channel || "push",
                data: alertData.data,
                createdAt: new Date(item.timestamp),
              });
              synced.push(item.id);
              syncedItems.add(item.id);
              break;
            }

            case "status": {
              // Status updates are logged but not persisted to main tables
              await createAlertLog({
                id: nanoid(),
                alertId: (item.data as any).alertId || "unknown",
                action: "status_update",
                details: item.data,
                createdAt: new Date(item.timestamp),
              });
              synced.push(item.id);
              syncedItems.add(item.id);
              break;
            }
          }
        } catch (error) {
          console.error(`Failed to sync item ${item.id}:`, error);
          failed.push(item.id);
        }
      }

      return {
        synced,
        failed,
        total: input.items.length,
      };
    }),

  // Get sync status
  status: publicProcedure.query(() => {
    return {
      syncedCount: syncedItems.size,
      isOnline: true,
    };
  }),

  // Clear sync cache (for testing/reset)
  clear: publicProcedure.mutation(() => {
    syncedItems.clear();
    return { success: true };
  }),
});
