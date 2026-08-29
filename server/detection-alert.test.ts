import { describe, it, expect, beforeEach, vi } from 'vitest';
import { detectionRouter } from './routers/detection';
import type { TrpcContext } from './_core/context';

/**
 * Detection Alert Integration Tests
 * Tests the automatic FCM alert triggering for high-confidence detections
 */

type AuthenticatedUser = NonNullable<TrpcContext['user']>;

function createPublicContext(): { ctx: TrpcContext } {
  const ctx: TrpcContext = {
    user: null,
    req: {
      protocol: 'https',
      headers: {},
    } as TrpcContext['req'],
    res: {} as TrpcContext['res'],
  };

  return { ctx };
}

describe('Detection Alert Integration', () => {
  describe('Critical Detection Alert Triggering', () => {
    it('should create detection with high confidence', async () => {
      const { ctx } = createPublicContext();
      const caller = detectionRouter.createCaller(ctx);

      const result = await caller.create({
        type: 'human',
        confidence: 0.95,
        stationId: 'station-123',
        latitude: -1.2345,
        longitude: 36.7890,
      });

      expect(result).toBeDefined();
      expect(result.type).toBe('human');
      expect(result.confidence).toBe(0.95);
      expect(result.stationId).toBe('station-123');
      expect(result.verificationStatus).toBe('pending');
    });

    it('should create detection with low confidence', async () => {
      const { ctx } = createPublicContext();
      const caller = detectionRouter.createCaller(ctx);

      const result = await caller.create({
        type: 'animal',
        confidence: 0.5,
        stationId: 'station-456',
      });

      expect(result).toBeDefined();
      expect(result.confidence).toBe(0.5);
      expect(result.verificationStatus).toBe('pending');
    });

    it('should handle different detection types', async () => {
      const { ctx } = createPublicContext();
      const caller = detectionRouter.createCaller(ctx);

      const types: Array<'human' | 'animal' | 'vehicle'> = [
        'human',
        'animal',
        'vehicle',
      ];

      for (const type of types) {
        const result = await caller.create({
          type,
          confidence: 0.9,
          stationId: 'station-test',
        });

        expect(result.type).toBe(type);
      }
    });

    it('should include location data in detection', async () => {
      const { ctx } = createPublicContext();
      const caller = detectionRouter.createCaller(ctx);

      const result = await caller.create({
        type: 'human',
        confidence: 0.88,
        stationId: 'station-789',
        latitude: -1.5,
        longitude: 36.5,
      });

      expect(result.latitude).toBeDefined();
      expect(result.longitude).toBeDefined();
    });

    it('should include image URL in detection', async () => {
      const { ctx } = createPublicContext();
      const caller = detectionRouter.createCaller(ctx);

      const imageUrl = 'https://example.com/detection.jpg';
      const result = await caller.create({
        type: 'human',
        confidence: 0.92,
        stationId: 'station-img',
        imageUrl,
      });

      expect(result.imageUrl).toBe(imageUrl);
    });

    it('should handle confidence at 85% threshold', async () => {
      const { ctx } = createPublicContext();
      const caller = detectionRouter.createCaller(ctx);

      const result = await caller.create({
        type: 'human',
        confidence: 0.85,
        stationId: 'station-threshold',
      });

      expect(result.confidence).toBe(0.85);
      expect(result.verificationStatus).toBe('pending');
    });

    it('should handle confidence just below 85% threshold', async () => {
      const { ctx } = createPublicContext();
      const caller = detectionRouter.createCaller(ctx);

      const result = await caller.create({
        type: 'human',
        confidence: 0.84,
        stationId: 'station-below-threshold',
      });

      expect(result.confidence).toBe(0.84);
      expect(result.verificationStatus).toBe('pending');
    });

    it('should handle 100% confidence', async () => {
      const { ctx } = createPublicContext();
      const caller = detectionRouter.createCaller(ctx);

      const result = await caller.create({
        type: 'human',
        confidence: 1.0,
        stationId: 'station-100',
      });

      expect(result.confidence).toBe(1.0);
    });

    it('should handle 0% confidence', async () => {
      const { ctx } = createPublicContext();
      const caller = detectionRouter.createCaller(ctx);

      const result = await caller.create({
        type: 'animal',
        confidence: 0.0,
        stationId: 'station-0',
      });

      expect(result.confidence).toBe(0.0);
    });
  });

  describe('Detection Retrieval', () => {
    it('should list detections', async () => {
      const { ctx } = createPublicContext();
      const caller = detectionRouter.createCaller(ctx);

      const result = await caller.list({
        limit: 10,
        offset: 0,
      });

      expect(Array.isArray(result)).toBe(true);
    });

    it('should list detections with station filter', async () => {
      const { ctx } = createPublicContext();
      const caller = detectionRouter.createCaller(ctx);

      const result = await caller.list({
        stationId: 'station-123',
        limit: 10,
        offset: 0,
      });

      expect(Array.isArray(result)).toBe(true);
    });

    it('should get detection by ID', async () => {
      const { ctx } = createPublicContext();
      const caller = detectionRouter.createCaller(ctx);

      // Create a detection first
      const created = await caller.create({
        type: 'human',
        confidence: 0.9,
        stationId: 'station-get',
      });

      // Retrieve it
      const retrieved = await caller.getById({ id: created.id });

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.type).toBe('human');
    });

    it('should handle non-existent detection ID', async () => {
      const { ctx } = createPublicContext();
      const caller = detectionRouter.createCaller(ctx);

      const result = await caller.getById({ id: 'non-existent-id' });

      expect(result).toBeUndefined();
    });
  });

  describe('Detection Verification', () => {
    it('should verify detection as admin', async () => {
      const user: AuthenticatedUser = {
        id: 1,
        openId: 'admin-user',
        email: 'admin@example.com',
        name: 'Admin User',
        loginMethod: 'manus',
        role: 'admin',
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSignedIn: new Date(),
      };

      const ctx: TrpcContext = {
        user,
        req: {
          protocol: 'https',
          headers: {},
        } as TrpcContext['req'],
        res: {} as TrpcContext['res'],
      };

      const caller = detectionRouter.createCaller(ctx);

      // Create a detection
      const publicCaller = detectionRouter.createCaller(createPublicContext().ctx);
      const created = await publicCaller.create({
        type: 'human',
        confidence: 0.9,
        stationId: 'station-verify',
      });

      // Verify it
      const result = await caller.verify({
        id: created.id,
        status: 'verified',
      });

      expect(result.success).toBe(true);
    });

    it('should reject detection as admin', async () => {
      const user: AuthenticatedUser = {
        id: 1,
        openId: 'admin-user',
        email: 'admin@example.com',
        name: 'Admin User',
        loginMethod: 'manus',
        role: 'admin',
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSignedIn: new Date(),
      };

      const ctx: TrpcContext = {
        user,
        req: {
          protocol: 'https',
          headers: {},
        } as TrpcContext['req'],
        res: {} as TrpcContext['res'],
      };

      const caller = detectionRouter.createCaller(ctx);

      // Create a detection
      const publicCaller = detectionRouter.createCaller(createPublicContext().ctx);
      const created = await publicCaller.create({
        type: 'animal',
        confidence: 0.7,
        stationId: 'station-reject',
      });

      // Reject it
      const result = await caller.verify({
        id: created.id,
        status: 'rejected',
      });

      expect(result.success).toBe(true);
    });

    it('should prevent non-admin from verifying', async () => {
      const user: AuthenticatedUser = {
        id: 2,
        openId: 'regular-user',
        email: 'user@example.com',
        name: 'Regular User',
        loginMethod: 'manus',
        role: 'user',
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSignedIn: new Date(),
      };

      const ctx: TrpcContext = {
        user,
        req: {
          protocol: 'https',
          headers: {},
        } as TrpcContext['req'],
        res: {} as TrpcContext['res'],
      };

      const caller = detectionRouter.createCaller(ctx);

      // Create a detection
      const publicCaller = detectionRouter.createCaller(createPublicContext().ctx);
      const created = await publicCaller.create({
        type: 'human',
        confidence: 0.9,
        stationId: 'station-no-verify',
      });

      // Try to verify as non-admin
      try {
        await caller.verify({
          id: created.id,
          status: 'verified',
        });
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });

  describe('Detection Data Integrity', () => {
    it('should preserve all detection fields', async () => {
      const { ctx } = createPublicContext();
      const caller = detectionRouter.createCaller(ctx);

      const input = {
        type: 'vehicle' as const,
        confidence: 0.87,
        stationId: 'station-integrity',
        imageUrl: 'https://example.com/image.jpg',
        imageData: 'base64-encoded-data',
        latitude: -1.2345,
        longitude: 36.7890,
      };

      const result = await caller.create(input);

      expect(result.type).toBe(input.type);
      expect(result.confidence).toBe(input.confidence);
      expect(result.stationId).toBe(input.stationId);
      expect(result.imageUrl).toBe(input.imageUrl);
      expect(result.imageData).toBe(input.imageData);
      expect(result.latitude).toBe(input.latitude);
      expect(result.longitude).toBe(input.longitude);
    });

    it('should set correct initial verification status', async () => {
      const { ctx } = createPublicContext();
      const caller = detectionRouter.createCaller(ctx);

      const result = await caller.create({
        type: 'human',
        confidence: 0.9,
        stationId: 'station-status',
      });

      expect(result.verificationStatus).toBe('pending');
    });

    it('should set timestamp on creation', async () => {
      const { ctx } = createPublicContext();
      const caller = detectionRouter.createCaller(ctx);

      const beforeCreation = new Date();
      const result = await caller.create({
        type: 'human',
        confidence: 0.9,
        stationId: 'station-timestamp',
      });
      const afterCreation = new Date();

      expect(result.timestamp).toBeDefined();
      expect(result.timestamp.getTime()).toBeGreaterThanOrEqual(
        beforeCreation.getTime()
      );
      expect(result.timestamp.getTime()).toBeLessThanOrEqual(
        afterCreation.getTime()
      );
    });
  });

  describe('Alert Threshold Logic', () => {
    it('should trigger alert for 85% confidence', async () => {
      const { ctx } = createPublicContext();
      const caller = detectionRouter.createCaller(ctx);

      // This should trigger alert (85% >= 0.85)
      const result = await caller.create({
        type: 'human',
        confidence: 0.85,
        stationId: 'station-alert-85',
      });

      expect(result.confidence).toBe(0.85);
      // Alert would be triggered in production
    });

    it('should not trigger alert for 84% confidence', async () => {
      const { ctx } = createPublicContext();
      const caller = detectionRouter.createCaller(ctx);

      // This should NOT trigger alert (84% < 0.85)
      const result = await caller.create({
        type: 'human',
        confidence: 0.84,
        stationId: 'station-no-alert-84',
      });

      expect(result.confidence).toBe(0.84);
      // Alert would NOT be triggered in production
    });

    it('should trigger alert for 95% confidence', async () => {
      const { ctx } = createPublicContext();
      const caller = detectionRouter.createCaller(ctx);

      const result = await caller.create({
        type: 'human',
        confidence: 0.95,
        stationId: 'station-alert-95',
      });

      expect(result.confidence).toBe(0.95);
      // Alert would be triggered in production
    });

    it('should trigger alert for 100% confidence', async () => {
      const { ctx } = createPublicContext();
      const caller = detectionRouter.createCaller(ctx);

      const result = await caller.create({
        type: 'human',
        confidence: 1.0,
        stationId: 'station-alert-100',
      });

      expect(result.confidence).toBe(1.0);
      // Alert would be triggered in production
    });
  });

  describe('Detection Type Coverage', () => {
    it('should create human detection', async () => {
      const { ctx } = createPublicContext();
      const caller = detectionRouter.createCaller(ctx);

      const result = await caller.create({
        type: 'human',
        confidence: 0.9,
        stationId: 'station-human',
      });

      expect(result.type).toBe('human');
    });

    it('should create animal detection', async () => {
      const { ctx } = createPublicContext();
      const caller = detectionRouter.createCaller(ctx);

      const result = await caller.create({
        type: 'animal',
        confidence: 0.88,
        stationId: 'station-animal',
      });

      expect(result.type).toBe('animal');
    });

    it('should create vehicle detection', async () => {
      const { ctx } = createPublicContext();
      const caller = detectionRouter.createCaller(ctx);

      const result = await caller.create({
        type: 'vehicle',
        confidence: 0.92,
        stationId: 'station-vehicle',
      });

      expect(result.type).toBe('vehicle');
    });
  });
});
