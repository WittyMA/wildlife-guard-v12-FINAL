/**
 * tRPC router for real-time mission monitoring
 * Provides queries for active missions, mission details, and live telemetry
 */

import { z } from 'zod';
import { publicProcedure, protectedProcedure, router } from '../_core/trpc';
import { getDb, getDroneMissionById } from '../db';
import { droneMissions, detectionEvents, cameraStations } from '../../drizzle/schema';
import { eq, inArray } from 'drizzle-orm';

export const monitoringRouter = router({
  // Get all active missions (pending, launched, in_progress)
  getActiveMissions: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) {
      return [];
    }

    try {
      const activeMissions = await db
        .select({
          id: droneMissions.id,
          detectionEventId: droneMissions.detectionEventId,
          droneId: droneMissions.droneId,
          status: droneMissions.status,
          targetLatitude: droneMissions.targetLatitude,
          targetLongitude: droneMissions.targetLongitude,
          verificationResult: droneMissions.verificationResult,
          launchedAt: droneMissions.launchedAt,
          createdAt: droneMissions.createdAt,
          updatedAt: droneMissions.updatedAt,
        })
        .from(droneMissions)
        .where(
          inArray(droneMissions.status, ['pending', 'launched', 'in_progress'])
        );

      return activeMissions;
    } catch (error) {
      console.error('[Monitoring] Error fetching active missions:', error);
      return [];
    }
  }),

  // Get detailed mission information with detection and station context
  getMissionDetails: publicProcedure
    .input(z.object({ missionId: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        return null;
      }

      try {
        const mission = await db
          .select()
          .from(droneMissions)
          .where(eq(droneMissions.id, input.missionId))
          .limit(1);

        if (mission.length === 0) {
          return null;
        }

        const missionData = mission[0];

        // Get detection details
        const detection = await db
          .select()
          .from(detectionEvents)
          .where(eq(detectionEvents.id, missionData.detectionEventId))
          .limit(1);

        // Get station details
        const station = await db
          .select()
          .from(cameraStations)
          .where(
            eq(
              cameraStations.id,
              detection.length > 0 ? detection[0].stationId : ''
            )
          )
          .limit(1);

        return {
          mission: missionData,
          detection: detection.length > 0 ? detection[0] : null,
          station: station.length > 0 ? station[0] : null,
        };
      } catch (error) {
        console.error('[Monitoring] Error fetching mission details:', error);
        return null;
      }
    }),

  // Get mission count by status
  getMissionStats: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) {
      return {
        pending: 0,
        launched: 0,
        inProgress: 0,
        completed: 0,
        failed: 0,
        total: 0,
      };
    }

    try {
      const allMissions = await db
        .select({
          status: droneMissions.status,
        })
        .from(droneMissions);

      const stats = {
        pending: 0,
        launched: 0,
        inProgress: 0,
        completed: 0,
        failed: 0,
        total: allMissions.length,
      };

      allMissions.forEach((m) => {
        if (m.status === 'pending') stats.pending++;
        else if (m.status === 'launched') stats.launched++;
        else if (m.status === 'in_progress') stats.inProgress++;
        else if (m.status === 'completed') stats.completed++;
        else if (m.status === 'failed') stats.failed++;
      });

      return stats;
    } catch (error) {
      console.error('[Monitoring] Error fetching mission stats:', error);
      return {
        pending: 0,
        launched: 0,
        inProgress: 0,
        completed: 0,
        failed: 0,
        total: 0,
      };
    }
  }),

  // Get missions by status
  getMissionsByStatus: publicProcedure
    .input(
      z.object({
        status: z.enum(['pending', 'launched', 'in_progress', 'completed', 'failed']),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        return [];
      }

      try {
        const missions = await db
          .select()
          .from(droneMissions)
          .where(eq(droneMissions.status, input.status));

        return missions;
      } catch (error) {
        console.error('[Monitoring] Error fetching missions by status:', error);
        return [];
      }
    }),

  // Get recent missions (last 24 hours)
  getRecentMissions: publicProcedure
    .input(z.object({ hours: z.number().default(24) }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        return [];
      }

      try {
        const hoursAgo = new Date(
          Date.now() - (input?.hours || 24) * 60 * 60 * 1000
        );

        const missions = await db
          .select()
          .from(droneMissions)
          .where(eq(droneMissions.status, 'completed'));

        // Filter in memory since we don't have a direct timestamp comparison
        return missions.filter((m) => m.completedAt && m.completedAt > hoursAgo);
      } catch (error) {
        console.error('[Monitoring] Error fetching recent missions:', error);
        return [];
      }
    }),

  // Get mission timeline (all missions with timestamps)
  getMissionTimeline: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) {
      return [];
    }

    try {
      const missions = await db
        .select({
          id: droneMissions.id,
          status: droneMissions.status,
          createdAt: droneMissions.createdAt,
          launchedAt: droneMissions.launchedAt,
          completedAt: droneMissions.completedAt,
          updatedAt: droneMissions.updatedAt,
        })
        .from(droneMissions);

      return missions.map((m) => ({
        ...m,
        duration:
          m.launchedAt && m.completedAt
            ? m.completedAt.getTime() - m.launchedAt.getTime()
            : null,
      }));
    } catch (error) {
      console.error('[Monitoring] Error fetching mission timeline:', error);
      return [];
    }
  }),

  // Simulate real-time mission update (for testing)
  simulateMissionUpdate: protectedProcedure
    .input(
      z.object({
        missionId: z.string(),
        batteryLevel: z.number().min(0).max(100).optional(),
        signalStrength: z.number().min(0).max(100).optional(),
        latitude: z.number().optional(),
        longitude: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      // This is a placeholder for real-time updates
      // In production, this would be handled by WebSocket or polling
      return {
        success: true,
        missionId: input.missionId,
        update: {
          batteryLevel: input.batteryLevel,
          signalStrength: input.signalStrength,
          latitude: input.latitude,
          longitude: input.longitude,
          timestamp: new Date(),
        },
      };
    }),

  // Get mission health status
  getMissionHealth: publicProcedure
    .input(z.object({ missionId: z.string() }))
    .query(async ({ input }) => {
      const mission = await getDroneMissionById(input.missionId);
      if (!mission) {
        return null;
      }

      // DJI PHANTOM 3 ADVANCED INTEGRATION: Fetch real telemetry from the drone bridge
      let batteryLevel = 75;
      let signalStrength = 85;

      try {
        const bridgeUrl = process.env.DRONE_BRIDGE_URL || 'http://localhost:5000';
        const response = await fetch(`${bridgeUrl}/telemetry`);
        if (response.ok) {
          const data = await response.json();
          if (typeof data.battery === 'number') batteryLevel = data.battery;
          if (typeof data.signal === 'number') signalStrength = data.signal;
        }
      } catch (error) {
        console.warn('[Monitoring] Could not fetch real-time telemetry from bridge, using defaults');
      }

      const health = {
        missionId: input.missionId,
        status: mission.status,
        isHealthy: mission.status === 'in_progress' || mission.status === 'launched',
        batteryLevel,
        signalStrength,
        flightTime: mission.launchedAt
          ? Math.floor(
              (Date.now() - mission.launchedAt.getTime()) / 1000 / 60
            )
          : 0,
        estimatedRemainingTime: batteryLevel > 20 ? Math.floor(batteryLevel / 4) : 0,
        warnings: [] as string[],
      };

      // Add warnings based on health metrics
      if (health.batteryLevel < 20) {
        health.warnings.push('Low battery warning');
      }
      if (health.signalStrength < 30) {
        health.warnings.push('Weak signal detected');
      }

      return health;
    }),

  // Get all active missions with full context
  getActiveMissionsWithContext: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) {
      return [];
    }

    try {
      const activeMissions = await db
        .select()
        .from(droneMissions)
        .where(
          inArray(droneMissions.status, ['pending', 'launched', 'in_progress'])
        );

      const missionsWithContext = await Promise.all(
        activeMissions.map(async (mission) => {
          const detection = await db
            .select()
            .from(detectionEvents)
            .where(eq(detectionEvents.id, mission.detectionEventId))
            .limit(1);

          const station = await db
            .select()
            .from(cameraStations)
            .where(
              eq(
                cameraStations.id,
                detection.length > 0 ? detection[0].stationId : ''
              )
            )
            .limit(1);

          return {
            mission,
            detection: detection.length > 0 ? detection[0] : null,
            station: station.length > 0 ? station[0] : null,
          };
        })
      );

      return missionsWithContext;
    } catch (error) {
      console.error(
        '[Monitoring] Error fetching active missions with context:',
        error
      );
      return [];
    }
  }),
});
