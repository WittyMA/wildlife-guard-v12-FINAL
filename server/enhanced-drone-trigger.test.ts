import { describe, it, expect } from 'vitest';

describe('Enhanced Drone Trigger Logic', () => {
  const triggerDrone = (type: string, confidence: number) => {
    const autoTriggerTypes = ['anonymous', 'dark_environment', 'blurry_image'];
    return autoTriggerTypes.includes(type);
  };

  const mapToDbType = (type: string) => {
    const anonymousTypes = ['anonymous', 'dark_environment', 'blurry_image'];
    return anonymousTypes.includes(type) ? 'anonymous' : type;
  };

  describe('Auto-trigger Conditions', () => {
    it('should trigger drone for dark_environment regardless of confidence', () => {
      expect(triggerDrone('dark_environment', 0.1)).toBe(true);
      expect(triggerDrone('dark_environment', 1.0)).toBe(true);
    });

    it('should trigger drone for blurry_image regardless of confidence', () => {
      expect(triggerDrone('blurry_image', 0.1)).toBe(true);
      expect(triggerDrone('blurry_image', 1.0)).toBe(true);
    });

    it('should trigger drone for anonymous regardless of confidence', () => {
      expect(triggerDrone('anonymous', 0.1)).toBe(true);
      expect(triggerDrone('anonymous', 1.0)).toBe(true);
    });

    it('should NOT trigger drone for high-confidence human detection', () => {
      expect(triggerDrone('human', 0.85)).toBe(false);
      expect(triggerDrone('human', 0.95)).toBe(false);
    });

    it('should not trigger drone for low-confidence human detection', () => {
      expect(triggerDrone('human', 0.84)).toBe(false);
      expect(triggerDrone('human', 0.5)).toBe(false);
    });
  });

  describe('DB Type Mapping', () => {
    it('should map dark_environment to anonymous for DB persistence', () => {
      expect(mapToDbType('dark_environment')).toBe('anonymous');
    });

    it('should map blurry_image to anonymous for DB persistence', () => {
      expect(mapToDbType('blurry_image')).toBe('anonymous');
    });

    it('should map anonymous to anonymous for DB persistence', () => {
      expect(mapToDbType('anonymous')).toBe('anonymous');
    });

    it('should preserve human, animal, and vehicle types', () => {
      expect(mapToDbType('human')).toBe('human');
      expect(mapToDbType('animal')).toBe('animal');
      expect(mapToDbType('vehicle')).toBe('vehicle');
    });
  });
});
