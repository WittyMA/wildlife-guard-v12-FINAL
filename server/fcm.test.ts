import { describe, it, expect, beforeEach } from 'vitest';
import {
  criticalDetectionTemplate,
  droneDeployedTemplate,
  droneCompletedTemplate,
  falseAlarmTemplate,
  lowBatteryTemplate,
  signalLostTemplate,
  systemAlertTemplate,
  rangerResponseTemplate,
  patternDetectionTemplate,
  offlineSyncCompleteTemplate,
} from '../server/_core/fcmTemplates';

describe('FCM Notification Templates', () => {
  describe('Critical Detection Template', () => {
    it('should create critical detection template for human', () => {
      const template = criticalDetectionTemplate('human', 0.95, 'North Station', -1.2345, 36.7890);

      expect(template.title).toContain('Critical');
      expect(template.body).toContain('Human');
      expect(template.body).toContain('95%');
      expect(template.body).toContain('North Station');
      expect(template.tag).toBe('critical-detection');
      expect(template.requireInteraction).toBe(true);
      expect(template.data?.actionUrl).toBe('/ranger-alerts');
    });

    it('should create critical detection template for animal', () => {
      const template = criticalDetectionTemplate('animal', 0.87, 'South Station');

      expect(template.body).toContain('Animal');
      expect(template.body).toContain('87%');
    });

    it('should create critical detection template for vehicle', () => {
      const template = criticalDetectionTemplate('vehicle', 0.92, 'East Station');

      expect(template.body).toContain('Vehicle');
      expect(template.body).toContain('92%');
    });

    it('should include location data when provided', () => {
      const template = criticalDetectionTemplate('human', 0.9, 'Station', -1.5, 36.5);

      expect(template.data?.latitude).toBe('-1.5');
      expect(template.data?.longitude).toBe('36.5');
    });
  });

  describe('Drone Deployment Template', () => {
    it('should create drone deployed template', () => {
      const template = droneDeployedTemplate('North Station', 'mission-123', -1.2345, 36.7890);

      expect(template.title).toContain('Drone');
      expect(template.body).toContain('North Station');
      expect(template.tag).toBe('drone-deployed');
      expect(template.requireInteraction).toBe(false);
      expect(template.data?.missionId).toBe('mission-123');
      expect(template.data?.actionUrl).toContain('mission-123');
    });
  });

  describe('Drone Completed Template', () => {
    it('should create drone completed template with confirmed result', () => {
      const template = droneCompletedTemplate('confirmed', 'mission-123', 'North Station');

      expect(template.title).toContain('Mission Complete');
      expect(template.body).toContain('Confirmed');
      expect(template.body).toContain('North Station');
      expect(template.tag).toBe('drone-completed');
      expect(template.data?.verificationResult).toBe('confirmed');
    });

    it('should create drone completed template with false alarm result', () => {
      const template = droneCompletedTemplate('false_alarm', 'mission-456', 'South Station');

      expect(template.body).toContain('False Alarm');
      expect(template.data?.verificationResult).toBe('false_alarm');
    });

    it('should create drone completed template with inconclusive result', () => {
      const template = droneCompletedTemplate('inconclusive', 'mission-789', 'East Station');

      expect(template.body).toContain('Inconclusive');
      expect(template.data?.verificationResult).toBe('inconclusive');
    });
  });

  describe('False Alarm Template', () => {
    it('should create false alarm template', () => {
      const template = falseAlarmTemplate('North Station', 'detection-123');

      expect(template.title).toContain('False Alarm');
      expect(template.body).toContain('North Station');
      expect(template.tag).toBe('false-alarm');
      expect(template.requireInteraction).toBe(false);
      expect(template.data?.detectionId).toBe('detection-123');
    });
  });

  describe('Low Battery Template', () => {
    it('should create low battery template', () => {
      const template = lowBatteryTemplate('North Station', 25);

      expect(template.title).toContain('Low Battery');
      expect(template.body).toContain('North Station');
      expect(template.body).toContain('25%');
      expect(template.tag).toBe('low-battery');
      expect(template.data?.batteryLevel).toBe('25');
    });

    it('should handle different battery levels', () => {
      const template10 = lowBatteryTemplate('Station', 10);
      expect(template10.body).toContain('10%');

      const template50 = lowBatteryTemplate('Station', 50);
      expect(template50.body).toContain('50%');
    });
  });

  describe('Signal Lost Template', () => {
    it('should create signal lost template', () => {
      const template = signalLostTemplate('North Station', '2026-04-10 10:30:00');

      expect(template.title).toContain('Signal Lost');
      expect(template.body).toContain('North Station');
      expect(template.body).toContain('2026-04-10 10:30:00');
      expect(template.tag).toBe('signal-lost');
      expect(template.requireInteraction).toBe(true);
    });
  });

  describe('System Alert Template', () => {
    it('should create system alert with info severity', () => {
      const template = systemAlertTemplate('System check completed', 'info');

      expect(template.title).toContain('System Alert');
      expect(template.body).toBe('System check completed');
      expect(template.tag).toBe('system-alert');
      expect(template.requireInteraction).toBe(false);
      expect(template.data?.severity).toBe('info');
    });

    it('should create system alert with warning severity', () => {
      const template = systemAlertTemplate('Database connection slow', 'warning');

      expect(template.body).toBe('Database connection slow');
      expect(template.data?.severity).toBe('warning');
      expect(template.requireInteraction).toBe(false);
    });

    it('should create system alert with error severity', () => {
      const template = systemAlertTemplate('Critical system error', 'error');

      expect(template.body).toBe('Critical system error');
      expect(template.data?.severity).toBe('error');
      expect(template.requireInteraction).toBe(true);
    });
  });

  describe('Ranger Response Template', () => {
    it('should create ranger response template', () => {
      const template = rangerResponseTemplate('John Ranger', 'North Station');

      expect(template.title).toContain('Ranger Response');
      expect(template.body).toContain('John Ranger');
      expect(template.body).toContain('North Station');
      expect(template.tag).toBe('ranger-response');
      expect(template.data?.rangerName).toBe('John Ranger');
    });
  });

  describe('Pattern Detection Template', () => {
    it('should create pattern detection template', () => {
      const template = patternDetectionTemplate('Recurring Activity', 'Multiple detections at 2 AM', 0.78);

      expect(template.title).toContain('Pattern Detected');
      expect(template.body).toContain('Recurring Activity');
      expect(template.body).toContain('Multiple detections at 2 AM');
      expect(template.body).toContain('78%');
      expect(template.tag).toBe('pattern-detected');
      expect(template.data?.patternType).toBe('Recurring Activity');
    });
  });

  describe('Offline Sync Complete Template', () => {
    it('should create offline sync complete template', () => {
      const template = offlineSyncCompleteTemplate(5);

      expect(template.title).toContain('Sync Complete');
      expect(template.body).toContain('5 detections');
      expect(template.tag).toBe('offline-sync-complete');
      expect(template.data?.itemCount).toBe('5');
    });

    it('should handle singular item', () => {
      const template = offlineSyncCompleteTemplate(1);

      expect(template.body).toContain('1 detection');
    });

    it('should handle multiple items', () => {
      const template = offlineSyncCompleteTemplate(10);

      expect(template.body).toContain('10 detections');
    });
  });

  describe('Template Structure Validation', () => {
    it('should have all required fields in critical detection template', () => {
      const template = criticalDetectionTemplate('human', 0.9, 'Station');

      expect(template.title).toBeDefined();
      expect(template.body).toBeDefined();
      expect(template.tag).toBeDefined();
      expect(template.requireInteraction).toBeDefined();
      expect(template.icon).toBeDefined();
      expect(template.badge).toBeDefined();
    });

    it('should have action URLs in all templates', () => {
      const templates = [
        criticalDetectionTemplate('human', 0.9, 'Station'),
        droneDeployedTemplate('Station', 'mission-1'),
        droneCompletedTemplate('confirmed', 'mission-1', 'Station'),
        falseAlarmTemplate('Station', 'detection-1'),
        lowBatteryTemplate('Station', 25),
        signalLostTemplate('Station', '10:00'),
        systemAlertTemplate('Alert'),
        rangerResponseTemplate('Ranger', 'Station'),
      ];

      templates.forEach((template) => {
        expect(template.data?.actionUrl).toBeDefined();
        expect(template.data?.actionUrl).toMatch(/^\/[a-z-]+/);
      });
    });

    it('should have consistent icon and badge across templates', () => {
      const templates = [
        criticalDetectionTemplate('human', 0.9, 'Station'),
        droneDeployedTemplate('Station', 'mission-1'),
        falseAlarmTemplate('Station', 'detection-1'),
      ];

      templates.forEach((template) => {
        expect(template.icon).toBe('/icon-192x192.png');
        expect(template.badge).toBe('/badge-72x72.png');
      });
    });
  });

  describe('Template Data Integrity', () => {
    it('should preserve special characters in station names', () => {
      const template = criticalDetectionTemplate('human', 0.9, "North-East's Station #1");

      expect(template.body).toContain("North-East's Station #1");
    });

    it('should handle very long station names', () => {
      const longName = 'A'.repeat(100);
      const template = criticalDetectionTemplate('human', 0.9, longName);

      expect(template.body).toContain(longName);
    });

    it('should handle confidence values at boundaries', () => {
      const template85 = criticalDetectionTemplate('human', 0.85, 'Station');
      expect(template85.body).toContain('85%');

      const template100 = criticalDetectionTemplate('human', 1.0, 'Station');
      expect(template100.body).toContain('100%');
    });
  });

  describe('FCM Notification Payload Structure', () => {
    it('should create valid FCM payload structure', () => {
      const template = criticalDetectionTemplate('human', 0.95, 'Station');

      // Validate structure for FCM
      expect(template).toHaveProperty('title');
      expect(template).toHaveProperty('body');
      expect(template).toHaveProperty('icon');
      expect(template).toHaveProperty('badge');
      expect(template).toHaveProperty('tag');
      expect(template).toHaveProperty('requireInteraction');
      expect(template).toHaveProperty('data');

      // Validate data payload
      expect(template.data).toHaveProperty('type');
      expect(template.data).toHaveProperty('actionUrl');
    });

    it('should have proper type in data payload', () => {
      const templates = [
        { template: criticalDetectionTemplate('human', 0.9, 'S'), type: 'critical_detection' },
        { template: droneDeployedTemplate('S', 'm'), type: 'drone_deployed' },
        { template: droneCompletedTemplate('confirmed', 'm', 'S'), type: 'drone_completed' },
        { template: falseAlarmTemplate('S', 'd'), type: 'false_alarm' },
        { template: lowBatteryTemplate('S', 25), type: 'low_battery' },
        { template: signalLostTemplate('S', 't'), type: 'signal_lost' },
        { template: systemAlertTemplate('msg'), type: 'system_alert' },
        { template: rangerResponseTemplate('R', 'S'), type: 'ranger_response' },
      ];

      templates.forEach(({ template, type }) => {
        expect(template.data?.type).toBe(type);
      });
    });
  });
});
