/**
 * tRPC router for detection events and related operations
 * Automatically triggers FCM alerts for high-confidence detections (85%+)
 */

import { z } from 'zod';
import { protectedProcedure, publicProcedure, router } from '../_core/trpc';
import {
  createDetectionEvent,
  getDetectionEvents,
  getDetectionEventById,
  updateDetectionVerification,
  getCameraStationById,
  createDroneMission,
  hasRecentDroneMission,
  getDb,
} from '../db';
import { nanoid } from 'nanoid';
import { sendNotificationToDevices, isFirebaseInitialized } from '../_core/firebase';
import { criticalDetectionTemplate } from '../_core/fcmTemplates';
import { rangerContacts } from '../../drizzle/schema';
import { eq } from 'drizzle-orm';

export const detectionRouter = router({
  // Get all detections with optional filtering
  list: publicProcedure
    .input(
      z.object({
        stationId: z.string().optional(),
        limit: z.number().default(50),
        offset: z.number().default(0),
      })
    )
    .query(async ({ input }) => {
      return getDetectionEvents(input.stationId, input.limit, input.offset);
    }),

  // Get a specific detection by ID
  getById: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      return getDetectionEventById(input.id);
    }),

  // Create a new detection event
  // Automatically triggers FCM alert for high-confidence detections (85%+)
  create: publicProcedure
    .input(
      z.object({
        type: z.enum(["human", "animal", "vehicle", "anonymous", "dark_environment", "blurry_image"]),
        confidence: z.number().min(0).max(1),
        stationId: z.string(),
        imageUrl: z.string().optional(),
        imageData: z.string().optional(),
        latitude: z.number().optional(),
        longitude: z.number().optional(),
        boundingBox: z.object({
          x: z.number(),
          y: z.number(),
          width: z.number(),
          height: z.number(),
        }).optional(),
      })
    )
    .mutation(async ({ input }) => {
      let detection: any;
      try {
        detection = await createDetectionEvent({
          id: nanoid(),
          type: (input.type === 'anonymous' || input.type === 'dark_environment' || input.type === 'blurry_image') ? 'anonymous' : input.type,
          confidence: input.confidence,
          stationId: input.stationId,
          imageUrl: input.imageUrl,
          imageData: input.imageData,
          latitude: input.latitude,
          longitude: input.longitude,
          boundingBox: input.boundingBox ? JSON.stringify(input.boundingBox) : null,
          timestamp: new Date(),
          verificationStatus: 'pending',
        });
      } catch (dbError: any) {
        console.warn('[Detection] Database unavailable, returning offline response:', dbError?.message);
        // Return a mock detection for offline mode so the client doesn't crash
        detection = {
          id: nanoid(),
          type: input.type,
          confidence: input.confidence,
          stationId: input.stationId,
          timestamp: new Date(),
          verificationStatus: 'pending',
          _offline: true,
        };
        return detection;
      }

      // Trigger FCM alert for high-confidence detections (85%+)
      if (input.confidence >= 0.85 && isFirebaseInitialized()) {
        try {
          // Get station details
          const station = await getCameraStationById(input.stationId);
          if (!station) {
            console.warn(
              `[Detection] Station ${input.stationId} not found for alert`
            );
          } else {
            // Get all active ranger tokens
            const db = await getDb();
            if (db) {
              const tokens = await db
                .select()
                .from(rangerContacts)
                .where(eq(rangerContacts.isActive, true));

              if (tokens.length > 0) {
                const fcmTokens = tokens.map((t) => t.fcmToken);
                const template = criticalDetectionTemplate(
                  input.type,
                  input.confidence,
                  station.name,
                  input.latitude,
                  input.longitude
                );

                const result = await sendNotificationToDevices(
                  fcmTokens,
                  template,
                  {
                    detectionType: input.type,
                    confidence: Math.round(input.confidence * 100).toString(),
                    stationId: input.stationId,
                    stationName: station.name,
                    latitude: input.latitude?.toString() || '',
                    longitude: input.longitude?.toString() || '',
                    imageUrl: input.imageUrl || '',
                    detectionId: detection.id,
                    actionUrl: '/ranger-alerts',
                  }
                );

                console.log(
                  `[Detection] Critical detection alert sent to ${result.successful} devices`
                );
              }
            }
          }
        } catch (error) {
          console.error('[Detection] Failed to send FCM alert:', error);
          // Don't throw - alert failure shouldn't block detection creation
        }
      }

      // AUTO-TRIGGER DRONE MISSION
      // Trigger drone ONLY when the system detects either anonymous_image, dark_environment, or blurry_image
      // With 5-minute per-station cooldown to prevent mission spam
      if (input.type === 'anonymous' || input.type === 'dark_environment' || input.type === 'blurry_image') {
        try {
          // CHECK COOLDOWN: Skip if a mission was already created for this station in the last 5 minutes
          const recentMissionExists = await hasRecentDroneMission(input.stationId, 300000);
          if (recentMissionExists) {
            console.log(`[Detection] Skipping drone trigger - recent mission exists for station ${input.stationId}`);
            return detection;
          }

          console.log(`[Detection] Auto-triggering drone mission for ${input.type} detection`);
          
          // Get station details for location
          const station = await getCameraStationById(input.stationId);
          
          // For anonymous, dark_environment, or blurry_image detections, we try to assign an available drone immediately
          let droneId: string | null = null;
          let status: 'pending' | 'launched' = 'pending';
          let launchedAt: Date | null = null;

          if (input.type === 'anonymous' || input.type === 'dark_environment' || input.type === 'blurry_image') {
            // Simple logic to find an "available" drone
            // In a real system, this would query a drones table for status='idle'
            // For now, we'll simulate finding an available drone if it's an anonymous detection
            droneId = `drone-auto-${nanoid(4)}`;
            status = 'launched';
            launchedAt = new Date();
            console.log(`[Detection] Anonymous detection: Auto-assigning drone ${droneId}`);
          }
          
          const mission = await createDroneMission({
            id: nanoid(),
            detectionEventId: detection.id,
            droneId,
            status,
            targetLatitude: input.latitude?.toString() || station?.latitude.toString() || '0',
            targetLongitude: input.longitude?.toString() || station?.longitude.toString() || '0',
            verificationResult: null,
            footageUrl: null,
            createdAt: new Date(),
            launchedAt,
            completedAt: null,
            updatedAt: new Date(),
          });
          
          console.log(`[Detection] Drone mission ${mission.id} created (${status}) for detection ${detection.id}`);

          // If we auto-launched, send notification
          if (status === 'launched' && isFirebaseInitialized() && station) {
            const db = await getDb();
            if (db) {
              const tokens = await db
                .select()
                .from(rangerContacts)
                .where(eq(rangerContacts.isActive, true));

              if (tokens.length > 0) {
                const { droneDeployedTemplate } = await import('../_core/fcmTemplates');
                const { sendNotificationToDevices } = await import('../_core/firebase');
                
                const fcmTokens = tokens.map((t) => t.fcmToken);
                const template = droneDeployedTemplate(station.name, mission.id);

                await sendNotificationToDevices(fcmTokens, template, {
                  missionId: mission.id,
                  droneId: droneId!,
                  stationId: input.stationId,
                  stationName: station.name,
                  status: 'launched',
                  actionUrl: '/missions',
                });
              }
            }
          }
        } catch (error) {
          console.error('[Detection] Failed to auto-trigger drone mission:', error);
        }
      }

      return detection;
    }),

  // Verify a detection (admin only)
  verify: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        status: z.enum(['verified', 'rejected']),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (ctx.user.role !== 'admin') {
        throw new Error('Only admins can verify detections');
      }
      await updateDetectionVerification(input.id, ctx.user.id, input.status);
      return { success: true };
    }),
});
