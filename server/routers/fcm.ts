import { z } from 'zod';
import { nanoid } from 'nanoid';
import { protectedProcedure, publicProcedure, router } from '../_core/trpc';
import { getDb } from '../db';
import { rangerContacts } from '../../drizzle/schema';
import { eq, and } from 'drizzle-orm';
import {
  sendNotificationToDevices,
  isFirebaseInitialized,
} from '../_core/firebase';
import {
  criticalDetectionTemplate,
  droneDeployedTemplate,
  droneCompletedTemplate,
  falseAlarmTemplate,
  lowBatteryTemplate,
  signalLostTemplate,
  systemAlertTemplate,
  rangerResponseTemplate,
} from '../_core/fcmTemplates';

export const fcmRouter = router({
  /**
   * Register FCM token for a device
   * Called from service worker when notification permission is granted
   */
  registerToken: protectedProcedure
    .input(
      z.object({
        fcmToken: z.string().min(1),
        deviceId: z.string().min(1),
        deviceName: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) {
        throw new Error('Database not available');
      }

      try {
        // Check if token already exists
        const existing = await db
          .select()
          .from(rangerContacts)
          .where(
            and(
              eq(rangerContacts.fcmToken, input.fcmToken),
              eq(rangerContacts.userId, ctx.user.id)
            )
          )
          .limit(1);

        if (existing.length > 0) {
          // Update existing token
          await db
            .update(rangerContacts)
            .set({
              deviceId: input.deviceId,
              deviceName: input.deviceName || existing[0].deviceName,
              isActive: true,
              updatedAt: new Date(),
            })
            .where(eq(rangerContacts.id, existing[0].id));

          return {
            success: true,
            message: 'Token updated',
            tokenId: existing[0].id,
          };
        }

        // Insert new token
        const tokenId = nanoid();
        await db.insert(rangerContacts).values({
          id: tokenId,
          userId: ctx.user.id,
          fcmToken: input.fcmToken,
          deviceId: input.deviceId,
          deviceName: input.deviceName || 'Unknown Device',
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        console.log(
          `[FCM] Token registered for user ${ctx.user.id} on device ${input.deviceId}`
        );

        return {
          success: true,
          message: 'Token registered',
          tokenId,
        };
      } catch (error) {
        console.error('[FCM] Failed to register token:', error);
        throw new Error('Failed to register FCM token');
      }
    }),

  /**
   * Unregister FCM token
   * Called when user logs out or revokes notification permission
   */
  unregisterToken: protectedProcedure
    .input(
      z.object({
        fcmToken: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) {
        throw new Error('Database not available');
      }

      try {
        await db
          .update(rangerContacts)
          .set({
            isActive: false,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(rangerContacts.fcmToken, input.fcmToken),
              eq(rangerContacts.userId, ctx.user.id)
            )
          );

        console.log(`[FCM] Token unregistered for user ${ctx.user.id}`);

        return {
          success: true,
          message: 'Token unregistered',
        };
      } catch (error) {
        console.error('[FCM] Failed to unregister token:', error);
        throw new Error('Failed to unregister FCM token');
      }
    }),

  /**
   * Get all active tokens for current user
   */
  getMyTokens: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) {
      throw new Error('Database not available');
    }

    try {
      const tokens = await db
        .select()
        .from(rangerContacts)
        .where(
          and(
            eq(rangerContacts.userId, ctx.user.id),
            eq(rangerContacts.isActive, true)
          )
        );

      return tokens.map((token) => ({
        id: token.id,
        deviceId: token.deviceId,
        deviceName: token.deviceName,
        createdAt: token.createdAt,
        lastUsed: token.lastUsed,
      }));
    } catch (error) {
      console.error('[FCM] Failed to get tokens:', error);
      throw new Error('Failed to retrieve tokens');
    }
  }),

  /**
   * Send test notification to current user's devices
   */
  sendTestNotification: protectedProcedure.mutation(async ({ ctx }) => {
    if (!isFirebaseInitialized()) {
      return {
        success: false,
        message: 'Firebase not initialized',
      };
    }

    const db = await getDb();
    if (!db) {
      throw new Error('Database not available');
    }

    try {
      const tokens = await db
        .select()
        .from(rangerContacts)
        .where(
          and(
            eq(rangerContacts.userId, ctx.user.id),
            eq(rangerContacts.isActive, true)
          )
        );

      if (tokens.length === 0) {
        return {
          success: false,
          message: 'No active devices registered',
        };
      }

      const fcmTokens = tokens.map((t) => t.fcmToken);
      const template = systemAlertTemplate('Test notification from Wildlife Guard', 'info');

      const result = await sendNotificationToDevices(fcmTokens, template, {
        type: 'test_notification',
        actionUrl: '/settings',
      });

      return {
        success: result.successful > 0,
        message: `Sent to ${result.successful} device(s)`,
        details: result,
      };
    } catch (error) {
      console.error('[FCM] Failed to send test notification:', error);
      throw new Error('Failed to send test notification');
    }
  }),

  /**
   * Send critical detection alert to all ranger devices
   * Called when detection confidence >= 85%
   */
  sendCriticalDetectionAlert: protectedProcedure
    .input(
      z.object({
        detectionType: z.enum(['human', 'animal', 'vehicle']),
        confidence: z.number().min(0.85).max(1),
        stationName: z.string(),
        stationId: z.string(),
        latitude: z.number().optional(),
        longitude: z.number().optional(),
        imageUrl: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!isFirebaseInitialized()) {
        return {
          success: false,
          message: 'Firebase not initialized',
        };
      }

      const db = await getDb();
      if (!db) {
        throw new Error('Database not available');
      }

      try {
        // Get all active ranger tokens
        const tokens = await db
          .select()
          .from(rangerContacts)
          .where(eq(rangerContacts.isActive, true));

        if (tokens.length === 0) {
          console.warn('[FCM] No active ranger devices to notify');
          return {
            success: false,
            message: 'No active ranger devices',
          };
        }

        const fcmTokens = tokens.map((t) => t.fcmToken);
        const template = criticalDetectionTemplate(
          input.detectionType,
          input.confidence,
          input.stationName,
          input.latitude,
          input.longitude
        );

        const result = await sendNotificationToDevices(fcmTokens, template, {
          detectionType: input.detectionType,
          confidence: Math.round(input.confidence * 100).toString(),
          stationId: input.stationId,
          stationName: input.stationName,
          latitude: input.latitude?.toString() || '',
          longitude: input.longitude?.toString() || '',
          imageUrl: input.imageUrl || '',
          actionUrl: '/ranger-alerts',
        });

        console.log(
          `[FCM] Critical detection alert sent to ${result.successful} devices`
        );

        return {
          success: result.successful > 0,
          message: `Alert sent to ${result.successful} device(s)`,
          details: result,
        };
      } catch (error) {
        console.error('[FCM] Failed to send critical detection alert:', error);
        throw new Error('Failed to send alert');
      }
    }),

  /**
   * Send drone deployment notification
   */
  sendDroneDeployedAlert: protectedProcedure
    .input(
      z.object({
        missionId: z.string(),
        stationName: z.string(),
        latitude: z.number().optional(),
        longitude: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!isFirebaseInitialized()) {
        return {
          success: false,
          message: 'Firebase not initialized',
        };
      }

      const db = await getDb();
      if (!db) {
        throw new Error('Database not available');
      }

      try {
        const tokens = await db
          .select()
          .from(rangerContacts)
          .where(eq(rangerContacts.isActive, true));

        if (tokens.length === 0) {
          return {
            success: false,
            message: 'No active ranger devices',
          };
        }

        const fcmTokens = tokens.map((t) => t.fcmToken);
        const template = droneDeployedTemplate(
          input.stationName,
          input.missionId,
          input.latitude,
          input.longitude
        );

        const result = await sendNotificationToDevices(fcmTokens, template, {
          missionId: input.missionId,
          stationName: input.stationName,
          actionUrl: `/ranger-alerts?mission=${input.missionId}`,
        });

        return {
          success: result.successful > 0,
          message: `Drone deployment alert sent to ${result.successful} device(s)`,
          details: result,
        };
      } catch (error) {
        console.error('[FCM] Failed to send drone deployed alert:', error);
        throw new Error('Failed to send alert');
      }
    }),

  /**
   * Send drone mission completed notification
   */
  sendDroneCompletedAlert: protectedProcedure
    .input(
      z.object({
        missionId: z.string(),
        verificationResult: z.enum(['confirmed', 'false_alarm', 'inconclusive']),
        stationName: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!isFirebaseInitialized()) {
        return {
          success: false,
          message: 'Firebase not initialized',
        };
      }

      const db = await getDb();
      if (!db) {
        throw new Error('Database not available');
      }

      try {
        const tokens = await db
          .select()
          .from(rangerContacts)
          .where(eq(rangerContacts.isActive, true));

        if (tokens.length === 0) {
          return {
            success: false,
            message: 'No active ranger devices',
          };
        }

        const fcmTokens = tokens.map((t) => t.fcmToken);
        const template = droneCompletedTemplate(
          input.verificationResult,
          input.missionId,
          input.stationName
        );

        const result = await sendNotificationToDevices(fcmTokens, template, {
          missionId: input.missionId,
          verificationResult: input.verificationResult,
          stationName: input.stationName,
          actionUrl: `/ranger-alerts?mission=${input.missionId}`,
        });

        return {
          success: result.successful > 0,
          message: `Drone completion alert sent to ${result.successful} device(s)`,
          details: result,
        };
      } catch (error) {
        console.error('[FCM] Failed to send drone completed alert:', error);
        throw new Error('Failed to send alert');
      }
    }),

  /**
   * Check if Firebase is initialized
   */
  isInitialized: publicProcedure.query(() => {
    return {
      initialized: isFirebaseInitialized(),
    };
  }),
});
