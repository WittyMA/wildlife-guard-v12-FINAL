/**
 * FCM Notification Templates for Wildlife Guard
 * Each template defines the notification structure for different alert types
 */

export interface FCMNotificationTemplate {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag: string;
  requireInteraction: boolean;
  data?: Record<string, string>;
}

/**
 * Critical Detection Alert
 * Triggered when human detected with 85%+ confidence
 */
export function criticalDetectionTemplate(
  detectionType: 'human' | 'animal' | 'vehicle',
  confidence: number,
  stationName: string,
  latitude?: number,
  longitude?: number
): FCMNotificationTemplate {
  const confidencePercent = Math.round(confidence * 100);
  return {
    title: '🚨 Critical Detection!',
    body: `${detectionType.charAt(0).toUpperCase() + detectionType.slice(1)} detected at ${stationName} (${confidencePercent}% confidence)`,
    icon: '/icon-192x192.png',
    badge: '/badge-72x72.png',
    tag: 'critical-detection',
    requireInteraction: true,
    data: {
      type: 'critical_detection',
      detectionType,
      confidence: confidencePercent.toString(),
      stationName,
      latitude: latitude?.toString() || '',
      longitude: longitude?.toString() || '',
      actionUrl: '/ranger-alerts',
    },
  };
}

/**
 * Drone Deployed Alert
 * Triggered when drone is deployed to verify detection
 */
export function droneDeployedTemplate(
  stationName: string,
  missionId: string,
  latitude?: number,
  longitude?: number
): FCMNotificationTemplate {
  return {
    title: '🚁 Drone Deployed',
    body: `Drone deployed to verify detection at ${stationName}`,
    icon: '/icon-192x192.png',
    badge: '/badge-72x72.png',
    tag: 'drone-deployed',
    requireInteraction: false,
    data: {
      type: 'drone_deployed',
      missionId,
      stationName,
      latitude: latitude?.toString() || '',
      longitude: longitude?.toString() || '',
      actionUrl: `/ranger-alerts?mission=${missionId}`,
    },
  };
}

/**
 * Drone Mission Completed Alert
 * Triggered when drone completes verification
 */
export function droneCompletedTemplate(
  verificationResult: 'confirmed' | 'false_alarm' | 'inconclusive',
  missionId: string,
  stationName: string
): FCMNotificationTemplate {
  const resultText =
    verificationResult === 'confirmed'
      ? '✓ Threat Confirmed'
      : verificationResult === 'false_alarm'
        ? '✗ False Alarm'
        : '❓ Inconclusive';

  return {
    title: '🚁 Mission Complete',
    body: `Drone verification complete: ${resultText} at ${stationName}`,
    icon: '/icon-192x192.png',
    badge: '/badge-72x72.png',
    tag: 'drone-completed',
    requireInteraction: false,
    data: {
      type: 'drone_completed',
      missionId,
      verificationResult,
      stationName,
      actionUrl: `/ranger-alerts?mission=${missionId}`,
    },
  };
}

/**
 * False Alarm Alert
 * Triggered when detection is marked as false alarm
 */
export function falseAlarmTemplate(
  stationName: string,
  detectionId: string
): FCMNotificationTemplate {
  return {
    title: '✗ False Alarm',
    body: `Detection at ${stationName} verified as false alarm`,
    icon: '/icon-192x192.png',
    badge: '/badge-72x72.png',
    tag: 'false-alarm',
    requireInteraction: false,
    data: {
      type: 'false_alarm',
      detectionId,
      stationName,
      actionUrl: '/detections',
    },
  };
}

/**
 * Low Battery Alert
 * Triggered when camera station battery is low
 */
export function lowBatteryTemplate(
  stationName: string,
  batteryLevel: number
): FCMNotificationTemplate {
  return {
    title: '🔋 Low Battery',
    body: `${stationName} battery at ${batteryLevel}%. Please recharge soon.`,
    icon: '/icon-192x192.png',
    badge: '/badge-72x72.png',
    tag: 'low-battery',
    requireInteraction: false,
    data: {
      type: 'low_battery',
      stationName,
      batteryLevel: batteryLevel.toString(),
      actionUrl: '/settings',
    },
  };
}

/**
 * Signal Lost Alert
 * Triggered when camera station loses connection
 */
export function signalLostTemplate(
  stationName: string,
  lastSeenTime: string
): FCMNotificationTemplate {
  return {
    title: '📡 Signal Lost',
    body: `${stationName} signal lost. Last seen: ${lastSeenTime}`,
    icon: '/icon-192x192.png',
    badge: '/badge-72x72.png',
    tag: 'signal-lost',
    requireInteraction: true,
    data: {
      type: 'signal_lost',
      stationName,
      lastSeenTime,
      actionUrl: '/monitor',
    },
  };
}

/**
 * System Alert
 * Triggered for system-level issues
 */
export function systemAlertTemplate(
  alertMessage: string,
  severity: 'info' | 'warning' | 'error' = 'warning'
): FCMNotificationTemplate {
  const icon =
    severity === 'error' ? '⚠️' : severity === 'warning' ? '⚡' : 'ℹ️';

  return {
    title: `${icon} System Alert`,
    body: alertMessage,
    icon: '/icon-192x192.png',
    badge: '/badge-72x72.png',
    tag: 'system-alert',
    requireInteraction: severity === 'error',
    data: {
      type: 'system_alert',
      severity,
      actionUrl: '/settings',
    },
  };
}

/**
 * Ranger Response Acknowledgment
 * Triggered when ranger acknowledges an alert
 */
export function rangerResponseTemplate(
  rangerName: string,
  stationName: string
): FCMNotificationTemplate {
  return {
    title: '✓ Ranger Response',
    body: `${rangerName} acknowledged alert at ${stationName}`,
    icon: '/icon-192x192.png',
    badge: '/badge-72x72.png',
    tag: 'ranger-response',
    requireInteraction: false,
    data: {
      type: 'ranger_response',
      rangerName,
      stationName,
      actionUrl: '/ranger-alerts',
    },
  };
}

/**
 * Pattern Detection Alert
 * Triggered when suspicious pattern is detected
 */
export function patternDetectionTemplate(
  patternType: string,
  description: string,
  confidence: number
): FCMNotificationTemplate {
  const confidencePercent = Math.round(confidence * 100);
  return {
    title: '🔍 Pattern Detected',
    body: `${patternType}: ${description} (${confidencePercent}% confidence)`,
    icon: '/icon-192x192.png',
    badge: '/badge-72x72.png',
    tag: 'pattern-detected',
    requireInteraction: false,
    data: {
      type: 'pattern_detected',
      patternType,
      confidence: confidencePercent.toString(),
      actionUrl: '/detections',
    },
  };
}

/**
 * Offline Sync Complete
 * Triggered when offline queue is synced
 */
export function offlineSyncCompleteTemplate(
  itemCount: number
): FCMNotificationTemplate {
  return {
    title: '☁️ Sync Complete',
    body: `${itemCount} detection${itemCount !== 1 ? 's' : ''} synced to server`,
    icon: '/icon-192x192.png',
    badge: '/badge-72x72.png',
    tag: 'offline-sync-complete',
    requireInteraction: false,
    data: {
      type: 'offline_sync_complete',
      itemCount: itemCount.toString(),
      actionUrl: '/monitor',
    },
  };
}

/**
 * Get all available templates for reference
 */
export const FCM_TEMPLATES = {
  criticalDetection: criticalDetectionTemplate,
  droneDeployed: droneDeployedTemplate,
  droneCompleted: droneCompletedTemplate,
  falseAlarm: falseAlarmTemplate,
  lowBattery: lowBatteryTemplate,
  signalLost: signalLostTemplate,
  systemAlert: systemAlertTemplate,
  rangerResponse: rangerResponseTemplate,
  patternDetection: patternDetectionTemplate,
  offlineSyncComplete: offlineSyncCompleteTemplate,
};

/**
 * Drone In-Progress Alert
 * Triggered when drone is actively verifying detection
 */
export function droneInProgressTemplate(
  missionId: string,
  stationName: string,
  batteryLevel?: number,
  signalStrength?: number
): FCMNotificationTemplate {
  const batteryText = batteryLevel ? ` (Battery: ${batteryLevel}%)` : '';
  return {
    title: '🚁 Mission In Progress',
    body: `Drone verifying detection at ${stationName}${batteryText}`,
    icon: '/icon-192x192.png',
    badge: '/badge-72x72.png',
    tag: 'drone-in-progress',
    requireInteraction: false,
    data: {
      type: 'drone_in_progress',
      missionId,
      stationName,
      batteryLevel: batteryLevel?.toString() || '',
      signalStrength: signalStrength?.toString() || '',
      actionUrl: `/ranger-alerts?mission=${missionId}`,
    },
  };
}

/**
 * Drone Failed Alert
 * Triggered when drone mission fails
 */
export function droneFailedTemplate(
  missionId: string,
  reason: string,
  stationName: string
): FCMNotificationTemplate {
  return {
    title: '❌ Mission Failed',
    body: `Drone mission failed at ${stationName}: ${reason}`,
    icon: '/icon-192x192.png',
    badge: '/badge-72x72.png',
    tag: 'drone-failed',
    requireInteraction: true,
    data: {
      type: 'drone_failed',
      missionId,
      stationName,
      reason,
      actionUrl: `/ranger-alerts?mission=${missionId}`,
    },
  };
}
