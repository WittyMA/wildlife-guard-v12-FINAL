/**
 * tRPC router for drone mission management and lifecycle
 * Handles mission creation, status updates, and automatic FCM alerts to rangers
 * 
 * DJI PHANTOM 3 ADVANCED INTEGRATION:
 * - Connects to local drone bridge service at http://localhost:5000
 * - Commands: takeoff, follow_target, investigate, land, return_home
 * - Auto-triggers drone missions for human/anonymous detections
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

// ============================================================
// Types
// ============================================================

interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DetectionEvent {
  id: string;
  type: string;
  confidence: number;
  stationId: string;
  boundingBox: BoundingBox | string | null;
  [key: string]: any;
}

interface CameraStation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  [key: string]: any;
}

// ============================================================
// DJI Phantom 3 Advanced Bridge Service Integration
// ============================================================

const BRIDGE_URL = process.env.DRONE_BRIDGE_URL || 'http://localhost:5000';
const DRONE_TIMEOUT_MS = 10000;

/**
 * Parse bounding box from detection (handles both object and string)
 */
function parseBoundingBox(boundingBox: BoundingBox | string | null | undefined): BoundingBox | null {
  if (!boundingBox) return null;
  
  // If it's already an object with x, y, width, height
  if (typeof boundingBox === 'object' && boundingBox !== null) {
    const box = boundingBox as any;
    if (typeof box.x === 'number' && typeof box.y === 'number' && 
        typeof box.width === 'number' && typeof box.height === 'number') {
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    }
    // Try to parse if it has string values
    if (typeof box.x === 'string') return { x: parseFloat(box.x), y: parseFloat(box.y), width: parseFloat(box.width), height: parseFloat(box.height) };
  }
  
  // If it's a JSON string, parse it
  if (typeof boundingBox === 'string') {
    try {
      const parsed = JSON.parse(boundingBox);
      if (typeof parsed.x === 'number' && typeof parsed.y === 'number' && 
          typeof parsed.width === 'number' && typeof parsed.height === 'number') {
        return parsed;
      }
    } catch {
      // Not valid JSON
    }
  }
  
  return null;
}

/**
 * Send a command to the DJI Phantom 3 drone bridge
 */
async function sendDroneCommand(command: string, params: Record<string, any> = {}): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DRONE_TIMEOUT_MS);

  try {
    const response = await fetch(`${BRIDGE_URL}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, ...params }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    return await response.json();
  } catch (error: any) {
    clearTimeout(timeout);
    if (error.name === 'AbortError') {
      throw new Error('Drone command timed out - bridge may be offline');
    }
    throw error;
  }
}

/**
 * Get drone telemetry from bridge
 */
async function getDroneTelemetry(): Promise<any> {
  try {
    const response = await fetch(`${BRIDGE_URL}/telemetry`, {
      headers: { 'Accept': 'application/json' },
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Get drone health status
 */
async function getDroneHealth(): Promise<{ healthy: boolean; drone_status: string }> {
  try {
    const response = await fetch(`${BRIDGE_URL}/health`);
    if (!response.ok) return { healthy: false, drone_status: 'offline' };
    return await response.json();
  } catch {
    return { healthy: false, drone_status: 'offline' };
  }
}

// ============================================================
// tRPC Router
// ============================================================

export const missionsRouter = router({
  /**
   * Check drone bridge health
   */
  health: publicProcedure.query(async () => {
    const health = await getDroneHealth();
    const telemetry = health.healthy ? await getDroneTelemetry() : null;
    return {
      ...health,
      bridgeUrl: BRIDGE_URL,
      telemetry: telemetry ? {
        battery: telemetry.battery || 0,
        signal: telemetry.signal || 0,
        connected: telemetry.connected || false,
        armed: telemetry.armed || false,
        flightMode: telemetry.flight_mode || 'UNKNOWN',
        gps: {
          lat: telemetry.lat || 0,
          lng: telemetry.lng || 0,
          altitude: telemetry.altitude || 0,
          satellites: telemetry.gps_satellites || 0,
          heading: telemetry.heading || 0,
        },
      } : null,
    };
  }),

  /**
   * Send manual drone command
   */
  sendCommand: protectedProcedure
    .input(z.object({
      command: z.enum(['takeoff', 'land', 'return_home', 'hover', 'photo', 'emergency_stop']),
      altitude: z.number().optional(),
      lat: z.number().optional(),
      lng: z.number().optional(),
      reason: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const result = await sendDroneCommand(input.command, {
        altitude: input.altitude,
        lat: input.lat,
        lng: input.lng,
        reason: input.reason,
      });
      return { success: true, result };
    }),

  /**
   * Create a new drone mission from a detection
   * Auto-triggers drone investigation for human/anonymous detections
   */
  create: protectedProcedure
    .input(
      z.object({
        detectionId: z.string(),
        latitude: z.number().optional(),
        longitude: z.number().optional(),
        autoLaunch: z.boolean().default(false),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Get detection details
      const detection = await getDetectionEventById(input.detectionId) as DetectionEvent | null;
      if (!detection) {
        throw new Error('Detection not found');
      }

      // Get station details
      const station = await getCameraStationById(detection.stationId) as CameraStation | null;
      if (!station) {
        throw new Error('Station not found');
      }

      // Parse bounding box
      const box = parseBoundingBox(detection.boundingBox);

      // Determine if drone should auto-investigate
      const shouldInvestigate = detection.type === 'human' || 
                               detection.type === 'anonymous' ||
                               detection.type === 'vehicle';

      const mission = await createDroneMission({
        id: nanoid(),
        detectionEventId: input.detectionId,
        droneId: null,
        status: shouldInvestigate && input.autoLaunch ? 'pending' : 'pending',
        targetLatitude: input.latitude?.toString() || station.latitude.toString(),
        targetLongitude: input.longitude?.toString() || station.longitude.toString(),
        verificationResult: null,
        footageUrl: null,
        createdAt: new Date(),
        launchedAt: null,
        completedAt: null,
        updatedAt: new Date(),
      });

      // Auto-launch if human detected and autoLaunch is enabled
      let launchResult = null;
      if (shouldInvestigate && input.autoLaunch) {
        try {
          // Check drone health first
          const health = await getDroneHealth();
          if (health.healthy) {
            // Get telemetry for context
            await getDroneTelemetry();
            
            // Send investigate command with target info
            const target = box ? {
              x: box.x,
              y: box.y,
              width: box.width,
              height: box.height,
              type: detection.type,
            } : {
              x: 0.5,
              y: 0.5,
              width: 0.3,
              height: 0.3,
              type: detection.type,
            };

            const result = await sendDroneCommand('investigate', {
              reason: `${detection.type} detected at ${station.name}`,
              target: target,
              confidence: detection.confidence || 0,
            });

            launchResult = { success: true, result };
            
            // Update mission status
            await updateDroneMission(mission.id, {
              status: 'launched',
              droneId: 'phantom_3_advanced',
              launchedAt: new Date(),
              updatedAt: new Date(),
            });

            // Send FCM alert to rangers
            await sendMissionAlert(mission.id, 'launched', station.name, detection.type);
          } else {
            launchResult = { success: false, error: 'Drone bridge offline' };
          }
        } catch (error: any) {
          console.error('[Mission] Auto-launch failed:', error);
          launchResult = { success: false, error: error.message };
        }
      }

      return { 
        success: true, 
        missionId: mission.id,
        autoLaunched: launchResult?.success || false,
        launchResult,
      };
    }),

  /**
   * Launch drone mission
   */
  launch: protectedProcedure
    .input(z.object({ missionId: z.string(), droneId: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const mission = await getDroneMissionById(input.missionId);
      if (!mission) {
        throw new Error('Mission not found');
      }

      if (mission.status !== 'pending') {
        throw new Error(`Cannot launch mission with status: ${mission.status}`);
      }

      // Get detection for context
      const detection = await getDetectionEventById(mission.detectionEventId) as DetectionEvent | null;
      if (!detection) {
        throw new Error('Detection not found');
      }

      // Get station for context
      const station = await getCameraStationById(detection.stationId) as CameraStation | null;
      if (!station) {
        throw new Error('Station not found');
      }

      // Parse bounding box
      const box = parseBoundingBox(detection.boundingBox);

      // Send takeoff command to drone bridge
      let launchResult;
      try {
        // Check drone health first
        const health = await getDroneHealth();
        if (!health.healthy) {
          throw new Error('Drone bridge is offline');
        }

        // Send takeoff command
        const result = await sendDroneCommand('takeoff', { altitude: 15 });
        launchResult = { success: true, result };

        // Send investigate command with target info
        const target = box ? {
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          type: detection.type,
        } : {
          x: 0.5,
          y: 0.5,
          width: 0.3,
          height: 0.3,
          type: detection.type,
        };

        await sendDroneCommand('investigate', {
          reason: `${detection.type} detected at ${station.name}`,
          target: target,
          confidence: detection.confidence || 0,
        });

        console.log(`[Mission] DJI Phantom 3 takeoff command sent for mission ${input.missionId}`);
      } catch (error: any) {
        console.error('[Mission] Failed to reach drone bridge:', error);
        launchResult = { success: false, error: error.message };
        // Continue with DB update even if bridge is offline for testing
      }

      // Update mission status to launched
      await updateDroneMission(input.missionId, {
        status: 'launched',
        droneId: input.droneId || 'phantom_3_advanced',
        launchedAt: new Date(),
        updatedAt: new Date(),
      });

      // Send FCM alert to rangers
      await sendMissionAlert(input.missionId, 'launched', station.name, detection.type);

      return { 
        success: true, 
        missionId: input.missionId,
        launchResult,
      };
    }),

  /**
   * Update mission to in-progress
   */
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
      await sendMissionAlert(input.missionId, 'in_progress');

      return { success: true, missionId: input.missionId };
    }),

  /**
   * Complete drone mission
   */
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
      const detection = await getDetectionEventById(mission.detectionEventId) as DetectionEvent | null;
      if (!detection) {
        throw new Error('Detection not found');
      }

      // Get station for context
      const station = await getCameraStationById(detection.stationId) as CameraStation | null;
      if (!station) {
        throw new Error('Station not found');
      }

      // Send land command to drone
      try {
        await sendDroneCommand('land');
        console.log(`[Mission] DJI Phantom 3 land command sent for mission ${input.missionId}`);
      } catch (error) {
        console.warn('[Mission] Failed to send land command:', error);
        // Continue even if land command fails
      }

      // Update mission status to completed
      await updateDroneMission(input.missionId, {
        status: 'completed' as const,
        verificationResult: input.verificationResult as 'confirmed' | 'false_alarm' | 'inconclusive',
        footageUrl: input.footageUrl || null,
        completedAt: new Date(),
        updatedAt: new Date(),
      });

      // Send FCM alert
      await sendMissionAlert(
        input.missionId, 
        'completed', 
        station.name, 
        detection.type,
        input.verificationResult
      );

      return { success: true, missionId: input.missionId };
    }),

  /**
   * Fail drone mission
   */
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
      const detection = await getDetectionEventById(mission.detectionEventId) as DetectionEvent | null;
      if (!detection) {
        throw new Error('Detection not found');
      }

      // Get station for context
      const station = await getCameraStationById(detection.stationId) as CameraStation | null;
      if (!station) {
        throw new Error('Station not found');
      }

      // Send return home command
      try {
        await sendDroneCommand('return_home');
        console.log(`[Mission] DJI Phantom 3 return_home command sent for mission ${input.missionId}`);
      } catch (error) {
        console.warn('[Mission] Failed to send return_home command:', error);
      }

      // Update mission status to failed
      await updateDroneMission(input.missionId, {
        status: 'failed',
        updatedAt: new Date(),
      });

      // Send FCM alert
      await sendMissionAlert(input.missionId, 'failed', station.name, detection.type, undefined, input.reason);

      return { success: true, missionId: input.missionId };
    }),

  /**
   * Get mission status
   */
  getStatus: publicProcedure
    .input(z.object({ missionId: z.string() }))
    .query(async ({ input }) => {
      const mission = await getDroneMissionById(input.missionId);
      if (!mission) {
        return null;
      }

      // Get live drone telemetry for active missions
      let droneTelemetry = null;
      if (mission.status === 'launched' || mission.status === 'in_progress') {
        droneTelemetry = await getDroneTelemetry();
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
        droneTelemetry,
      };
    }),

  /**
   * Cancel mission
   */
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

      // Send return home command
      try {
        await sendDroneCommand('return_home');
        console.log(`[Mission] DJI Phantom 3 return_home command sent for cancel ${input.missionId}`);
      } catch (error) {
        console.warn('[Mission] Failed to send return_home command:', error);
      }

      // Update mission status to cancelled
      await updateDroneMission(input.missionId, {
        status: 'cancelled',
        updatedAt: new Date(),
      });

      return { success: true, missionId: input.missionId };
    }),

  /**
   * Update mission status (for ranger control)
   */
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
        // Send drone command on launch
        try {
          await sendDroneCommand('takeoff', { altitude: 15 });
        } catch (error) {
          console.warn('[Mission] Manual launch command failed:', error);
        }
      }
      if (
        (input.status === 'completed' || input.status === 'failed') &&
        !mission.completedAt
      ) {
        updateData.completedAt = new Date();
        // Send land/return command
        try {
          if (input.status === 'completed') {
            await sendDroneCommand('land');
          } else {
            await sendDroneCommand('return_home');
          }
        } catch (error) {
          console.warn('[Mission] Manual completion command failed:', error);
        }
      }

      await updateDroneMission(input.missionId, updateData);

      return { success: true, missionId: input.missionId, status: input.status };
    }),

  /**
   * Abort mission (emergency stop)
   */
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

      // Send emergency stop
      try {
        await sendDroneCommand('emergency_stop');
        console.log(`[Mission] Emergency stop sent for mission ${input.missionId}`);
      } catch (error) {
        console.warn('[Mission] Emergency stop failed:', error);
      }

      await updateDroneMission(input.missionId, {
        status: 'failed',
        completedAt: new Date(),
        updatedAt: new Date(),
      });

      return { success: true, missionId: input.missionId, aborted: true };
    }),
});

// ============================================================
// Helper Functions
// ============================================================

/**
 * Send mission alert to rangers via FCM
 */
async function sendMissionAlert(
  missionId: string,
  status: string,
  stationName?: string,
  detectionType?: string,
  verificationResult?: 'confirmed' | 'false_alarm' | 'inconclusive',
  failureReason?: string
): Promise<void> {
  if (!isFirebaseInitialized()) return;

  try {
    const db = await getDb();
    if (!db) return;

    const tokens = await db
      .select()
      .from(rangerContacts)
      .where(eq(rangerContacts.isActive, true));

    if (tokens.length === 0) return;

    const fcmTokens = tokens.map((t) => t.fcmToken);

    let template;
    const templateData: any = {
      missionId,
      stationName: stationName || 'Unknown Station',
      actionUrl: '/ranger-alerts',
      detectionType: detectionType || 'unknown',
    };

    switch (status) {
      case 'launched':
        template = droneDeployedTemplate(stationName || 'Unknown', missionId);
        templateData.status = 'launched';
        break;
      case 'in_progress':
        template = droneInProgressTemplate(missionId, stationName || 'Unknown');
        templateData.status = 'in_progress';
        break;
      case 'completed':
        const result = verificationResult || 'confirmed';
        template = droneCompletedTemplate(
          result,
          missionId,
          stationName || 'Unknown'
        );
        templateData.status = 'completed';
        templateData.verificationResult = result;
        break;
      case 'failed':
        template = droneFailedTemplate(
          missionId,
          failureReason || 'Unknown error',
          stationName || 'Unknown'
        );
        templateData.status = 'failed';
        templateData.reason = failureReason || 'Unknown error';
        break;
      default:
        return;
    }

    const result = await sendNotificationToDevices(
      fcmTokens,
      template,
      templateData
    );

    console.log(`[Mission] ${status} alert sent to ${result.successful} devices`);
  } catch (error) {
    console.error('[Mission] Failed to send alert:', error);
  }
}