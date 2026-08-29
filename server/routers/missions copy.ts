/**
 * tRPC router for drone mission management and lifecycle
 * Handles mission creation, status updates, and automatic FCM alerts to rangers
 */

import { z } from 'zod';
import { protectedProcedure, publicProcedure, router } from '../_core/trpc';
import {
  createDroneMission,
  getDroneMissionById,
  updateDroneMission,
  getDb,
  getDetectionEventById,
  getCameraStationById,
} from '../db';
import { nanoid } from 'nanoid';
import { sendNotificationToDevices, isFirebaseInitialized } from '../_core/firebase';
import {
  droneDeployedTemplate,
  droneCompletedTemplate,
  droneFailedTemplate,
  droneInProgressTemplate,
} from '../_core/fcmTemplates';
import { rangerContacts } from '../../drizzle/schema';
import { eq } from 'drizzle-orm';

export const missionsRouter = router({
  // Create a new drone mission from a detection
  create: protectedProcedure
    .input(
      z.object({
        detectionId: z.string(),
        latitude: z.number().optional(),
        longitude: z.number().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Get detection details
      const detection = await getDetectionEventById(input.detectionId);
      if (!detection) {
        throw new Error('Detection not found');
      }

      // Get station details
      const station = await getCameraStationById(detection.stationId);
      if (!station) {
        throw new Error('Station not found');
      }

      const mission = await createDroneMission({
        id: nanoid(),
        detectionEventId: input.detectionId,
        droneId: null,
        status: 'pending',
        targetLatitude: input.latitude?.toString() || station.latitude.toString(),
        targetLongitude: input.longitude?.toString() || station.longitude.toString(),
        verificationResult: null,
        footageUrl: null,
        createdAt: new Date(),
        launchedAt: null,
        completedAt: null,
        updatedAt: new Date(),
      });

      return { success: true, missionId: mission.id };
    }),

  // Launch drone mission
  launch: protectedProcedure
    .input(z.object({ missionId: z.string(), droneId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const mission = await getDroneMissionById(input.missionId);
      if (!mission) {
        throw new Error('Mission not found');
      }

      if (mission.status !== 'pending') {
        throw new Error(`Cannot launch mission with status: ${mission.status}`);
      }

      // Get detection for context
      const detection = await getDetectionEventById(mission.detectionEventId);
      if (!detection) {
        throw new Error('Detection not found');
      }

      // Get station for context
      const station = await getCameraStationById(detection.stationId);
      if (!station) {
        throw new Error('Station not found');
      }

      // DJI PHANTOM 3 ADVANCED INTEGRATION: Call the local drone bridge service
      try {
        const bridgeUrl = process.env.DRONE_BRIDGE_URL || 'http://localhost:5000';
        await fetch(`${bridgeUrl}/command`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: 'takeoff' })
        });
        console.log(`[Mission] DJI Phantom 3 takeoff command sent for mission ${input.missionId}`);
      } catch (error) {
        console.error('[Mission] Failed to reach drone bridge:', error);
        // We continue with the DB update even if bridge is offline for testing/simulation
      }

      // Update mission status to launched
      await updateDroneMission(input.missionId, {
        status: 'launched',
        droneId: input.droneId,
        launchedAt: new Date(),
        updatedAt: new Date(),
      });

      // Send FCM alert to rangers
      if (isFirebaseInitialized()) {
        try {
          const db = await getDb();
          if (db) {
            const tokens = await db
              .select()
              .from(rangerContacts)
              .where(eq(rangerContacts.isActive, true));

            if (tokens.length > 0) {
              const fcmTokens = tokens.map((t) => t.fcmToken);
              const template = droneDeployedTemplate(
                station.name,
                input.missionId
              );

              const result = await sendNotificationToDevices(
                fcmTokens,
                template,
                {
                  missionId: input.missionId,
                  droneId: input.droneId,
                  stationId: detection.stationId,
                  stationName: station.name,
                  status: 'launched',
                  actionUrl: '/missions',
                }
              );

              console.log(
                `[Mission] Launch alert sent to ${result.successful} devices`
              );
            }
          }
        } catch (error) {
          console.error('[Mission] Failed to send launch alert:', error);
        }
      }

      return { success: true, missionId: input.missionId };
    }),

  // Update mission to in-progress
  markInProgress: protectedProcedure
    .input(z.object({ missionId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const mission = await getDroneMissionById(input.missionId);
      if (!mission) {
        throw new Error('Mission not found');
      }

      if (mission.status !== 'launched') {
        throw new Error(`Cannot mark as in-progress from status: ${mission.status}`);
      }

      // Update mission status
      await updateDroneMission(input.missionId, {
        status: 'in_progress',
        updatedAt: new Date(),
      });

      // Send FCM alert
      if (isFirebaseInitialized()) {
        try {
          const detection = await getDetectionEventById(mission.detectionEventId);
          const station = await getCameraStationById(detection?.stationId || '');

          if (detection && station) {
            const db = await getDb();
            if (db) {
              const tokens = await db
                .select()
                .from(rangerContacts)
                .where(eq(rangerContacts.isActive, true));

              if (tokens.length > 0) {
                const fcmTokens = tokens.map((t) => t.fcmToken);
                const template = droneInProgressTemplate(
                  input.missionId,
                  station.name
                );

                const result = await sendNotificationToDevices(
                  fcmTokens,
                  template,
                  {
                    missionId: input.missionId,
                    stationId: detection.stationId,
                    stationName: station.name,
                    status: 'in_progress',
                    actionUrl: '/missions',
                  }
                );

                console.log(
                  `[Mission] In-progress alert sent to ${result.successful} devices`
                );
              }
            }
          }
        } catch (error) {
          console.error('[Mission] Failed to send in-progress alert:', error);
        }
      }

      return { success: true, missionId: input.missionId };
    }),

  // Complete drone mission
  complete: protectedProcedure
    .input(
      z.object({
        missionId: z.string(),
        verificationResult: z.enum(['confirmed', 'false_alarm', 'inconclusive']),
        footageUrl: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const mission = await getDroneMissionById(input.missionId);
      if (!mission) {
        throw new Error('Mission not found');
      }

      if (!['launched', 'in_progress'].includes(mission.status)) {
        throw new Error(`Cannot complete mission with status: ${mission.status}`);
      }

      // Get detection for context
      const detection = await getDetectionEventById(mission.detectionEventId);
      if (!detection) {
        throw new Error('Detection not found');
      }

      // Get station for context
      const station = await getCameraStationById(detection.stationId);
      if (!station) {
        throw new Error('Station not found');
      }

      // Update mission status to completed
      await updateDroneMission(input.missionId, {
        status: 'completed' as const,
        verificationResult: input.verificationResult as 'confirmed' | 'false_alarm' | 'inconclusive',
        footageUrl: input.footageUrl || null,
        completedAt: new Date(),
        updatedAt: new Date(),
      });

      // Send FCM alert to rangers
      if (isFirebaseInitialized()) {
        try {
          const db = await getDb();
          if (db) {
            const tokens = await db
              .select()
              .from(rangerContacts)
              .where(eq(rangerContacts.isActive, true));

            if (tokens.length > 0) {
              const fcmTokens = tokens.map((t) => t.fcmToken);
              const template = droneCompletedTemplate(
                input.verificationResult as 'confirmed' | 'false_alarm' | 'inconclusive',
                input.missionId,
                station.name
              );

              const result = await sendNotificationToDevices(
                fcmTokens,
                template,
                {
                  missionId: input.missionId,
                  stationId: detection.stationId,
                  stationName: station.name,
                  status: 'completed',
                  verificationResult: input.verificationResult,
                  footageUrl: input.footageUrl || '',
                  actionUrl: '/ranger-alerts',
                }
              );

              console.log(
                `[Mission] Completion alert sent to ${result.successful} devices`
              );
            }
          }
        } catch (error) {
          console.error('[Mission] Failed to send completion alert:', error);
        }
      }

      return { success: true, missionId: input.missionId };
    }),

  // Fail drone mission
  fail: protectedProcedure
    .input(
      z.object({
        missionId: z.string(),
        reason: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const mission = await getDroneMissionById(input.missionId);
      if (!mission) {
        throw new Error('Mission not found');
      }

      if (mission.status === 'completed' || mission.status === 'failed') {
        throw new Error(`Cannot fail mission with status: ${mission.status}`);
      }

      // Get detection for context
      const detection = await getDetectionEventById(mission.detectionEventId);
      if (!detection) {
        throw new Error('Detection not found');
      }

      // Get station for context
      const station = await getCameraStationById(detection.stationId);
      if (!station) {
        throw new Error('Station not found');
      }

      // Update mission status to failed
      await updateDroneMission(input.missionId, {
        status: 'failed',
        updatedAt: new Date(),
      });

      // Send FCM alert to rangers
      if (isFirebaseInitialized()) {
        try {
          const db = await getDb();
          if (db) {
            const tokens = await db
              .select()
              .from(rangerContacts)
              .where(eq(rangerContacts.isActive, true));

            if (tokens.length > 0) {
              const fcmTokens = tokens.map((t) => t.fcmToken);
              const template = droneFailedTemplate(
                input.missionId,
                input.reason,
                station.name
              );

              const result = await sendNotificationToDevices(
                fcmTokens,
                template,
                {
                  missionId: input.missionId,
                  stationId: detection.stationId,
                  stationName: station.name,
                  status: 'failed',
                  reason: input.reason,
                  actionUrl: '/ranger-alerts',
                }
              );

              console.log(
                `[Mission] Failure alert sent to ${result.successful} devices`
              );
            }
          }
        } catch (error) {
          console.error('[Mission] Failed to send failure alert:', error);
        }
      }

      return { success: true, missionId: input.missionId };
    }),

  // Get mission status
  getStatus: publicProcedure
    .input(z.object({ missionId: z.string() }))
    .query(async ({ input }) => {
      const mission = await getDroneMissionById(input.missionId);
      if (!mission) {
        return null;
      }

      return {
        id: mission.id,
        status: mission.status,
        droneId: mission.droneId,
        verificationResult: mission.verificationResult,
        footageUrl: mission.footageUrl,
        createdAt: mission.createdAt,
        launchedAt: mission.launchedAt,
        completedAt: mission.completedAt,
        updatedAt: mission.updatedAt,
      };
    }),

  // Cancel mission
  cancel: protectedProcedure
    .input(z.object({ missionId: z.string(), reason: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const mission = await getDroneMissionById(input.missionId);
      if (!mission) {
        throw new Error('Mission not found');
      }

      if (mission.status === 'completed' || mission.status === 'failed') {
        throw new Error(`Cannot cancel mission with status: ${mission.status}`);
      }

      // Update mission status to cancelled
      await updateDroneMission(input.missionId, {
        status: 'cancelled',
        updatedAt: new Date(),
      });

      return { success: true, missionId: input.missionId };
    }),

  // Update mission status (for ranger control)
  updateStatus: protectedProcedure
    .input(
      z.object({
        missionId: z.string(),
        status: z.enum(['pending', 'launched', 'in_progress', 'completed', 'failed', 'cancelled']),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const mission = await getDroneMissionById(input.missionId);
      if (!mission) {
        throw new Error('Mission not found');
      }

      const updateData: any = {
        status: input.status,
        updatedAt: new Date(),
      };

      if (input.status === 'launched' && !mission.launchedAt) {
        updateData.launchedAt = new Date();
      }
      if (
        (input.status === 'completed' || input.status === 'failed') &&
        !mission.completedAt
      ) {
        updateData.completedAt = new Date();
      }

      await updateDroneMission(input.missionId, updateData);

      return { success: true, missionId: input.missionId, status: input.status };
    }),

  // Abort mission (emergency stop)
  abort: protectedProcedure
    .input(
      z.object({
        missionId: z.string(),
        reason: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const mission = await getDroneMissionById(input.missionId);
      if (!mission) {
        throw new Error('Mission not found');
      }

      if (!['pending', 'launched', 'in_progress'].includes(mission.status)) {
        throw new Error(`Cannot abort mission with status: ${mission.status}`);
      }

      await updateDroneMission(input.missionId, {
        status: 'failed',
        completedAt: new Date(),
        updatedAt: new Date(),
      });

      return { success: true, missionId: input.missionId, aborted: true };
    }),
});
