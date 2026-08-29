import * as admin from 'firebase-admin';
import { ENV } from './env';

let firebaseApp: admin.app.App | null = null;
let messagingClient: admin.messaging.Messaging | null = null;

/**
 * Initialize Firebase Admin SDK
 * Requires FIREBASE_PROJECT_ID, FIREBASE_PRIVATE_KEY, FIREBASE_CLIENT_EMAIL env vars
 */
export async function initializeFirebase(): Promise<void> {
  if (firebaseApp) {
    return; // Already initialized
  }

  try {
    // Check if required environment variables are set
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;

    if (!projectId || !privateKey || !clientEmail) {
      console.warn('[Firebase] Missing credentials. FCM features will be disabled.');
      console.warn('[Firebase] Required env vars: FIREBASE_PROJECT_ID, FIREBASE_PRIVATE_KEY, FIREBASE_CLIENT_EMAIL');
      return;
    }

    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        privateKey: privateKey.replace(/\\n/g, '\n'),
        clientEmail,
      }),
      projectId,
    });

    messagingClient = admin.messaging(firebaseApp);
    console.log('[Firebase] Admin SDK initialized successfully');
  } catch (error) {
    console.error('[Firebase] Failed to initialize:', error);
    throw error;
  }
}

/**
 * Send a single notification to a device via FCM token
 */
export async function sendNotificationToDevice(
  fcmToken: string,
  notification: {
    title: string;
    body: string;
    icon?: string;
    badge?: string;
    tag?: string;
    requireInteraction?: boolean;
  },
  data?: Record<string, string>
): Promise<string | null> {
  if (!messagingClient) {
    console.warn('[FCM] Messaging client not initialized. Skipping notification.');
    return null;
  }

  try {
    const messageId = await messagingClient.send({
      token: fcmToken,
      notification: {
        title: notification.title,
        body: notification.body,
      },
      data: {
        ...data,
        icon: notification.icon || '/icon-192x192.png',
        badge: notification.badge || '/badge-72x72.png',
        tag: notification.tag || 'wildlife-guard',
        requireInteraction: notification.requireInteraction ? 'true' : 'false',
      },
      webpush: {
        notification: {
          title: notification.title,
          body: notification.body,
          icon: notification.icon || '/icon-192x192.png',
          badge: notification.badge || '/badge-72x72.png',
          tag: notification.tag || 'wildlife-guard',
          requireInteraction: notification.requireInteraction || false,
          actions: [
            {
              action: 'open',
              title: 'Open',
            },
            {
              action: 'close',
              title: 'Close',
            },
          ],
        },
        fcmOptions: {
          link: data?.actionUrl || '/',
        },
      },
    });

    console.log(`[FCM] Notification sent to device. Message ID: ${messageId}`);
    return messageId;
  } catch (error) {
    console.error('[FCM] Failed to send notification:', error);
    return null;
  }
}

/**
 * Send notifications to multiple devices (broadcast)
 */
export async function sendNotificationToDevices(
  fcmTokens: string[],
  notification: {
    title: string;
    body: string;
    icon?: string;
    badge?: string;
    tag?: string;
    requireInteraction?: boolean;
  },
  data?: Record<string, string>
): Promise<{ successful: number; failed: number; errors: string[] }> {
  if (!messagingClient) {
    console.warn('[FCM] Messaging client not initialized. Skipping broadcast.');
    return { successful: 0, failed: fcmTokens.length, errors: ['FCM not initialized'] };
  }

  const results = {
    successful: 0,
    failed: 0,
    errors: [] as string[],
  };

  // Send in batches of 500 (FCM limit)
  const batchSize = 500;
  for (let i = 0; i < fcmTokens.length; i += batchSize) {
    const batch = fcmTokens.slice(i, i + batchSize);

    try {
      const response = await (messagingClient as any).sendMulticast({
        tokens: batch,
        notification: {
          title: notification.title,
          body: notification.body,
        },
        data: {
          ...data,
          icon: notification.icon || '/icon-192x192.png',
          badge: notification.badge || '/badge-72x72.png',
          tag: notification.tag || 'wildlife-guard',
          requireInteraction: notification.requireInteraction ? 'true' : 'false',
        },
        webpush: {
          notification: {
            title: notification.title,
            body: notification.body,
            icon: notification.icon || '/icon-192x192.png',
            badge: notification.badge || '/badge-72x72.png',
            tag: notification.tag || 'wildlife-guard',
            requireInteraction: notification.requireInteraction || false,
            actions: [
              {
                action: 'open',
                title: 'Open',
              },
              {
                action: 'close',
                title: 'Close',
              },
            ],
          },
          fcmOptions: {
            link: data?.actionUrl || '/',
          },
        },
      });

      results.successful += response.successCount;
      results.failed += response.failureCount;

      // Log failed tokens
      response.responses.forEach((resp: any, idx: number) => {
        if (!resp.success) {
          const error = resp.error?.message || 'Unknown error';
          results.errors.push(`${batch[idx]}: ${error}`);
        }
      });

      console.log(
        `[FCM] Batch ${Math.floor(i / batchSize) + 1}: ${response.successCount} successful, ${response.failureCount} failed`
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      results.failed += batch.length;
      results.errors.push(`Batch error: ${errorMsg}`);
      console.error('[FCM] Batch send failed:', error);
    }
  }

  return results;
}

/**
 * Subscribe a device to a topic
 */
export async function subscribeToTopic(fcmTokens: string[], topic: string): Promise<boolean> {
  if (!messagingClient) {
    console.warn('[FCM] Messaging client not initialized. Cannot subscribe to topic.');
    return false;
  }

  try {
    await messagingClient.subscribeToTopic(fcmTokens, topic);
    console.log(`[FCM] Subscribed ${fcmTokens.length} devices to topic: ${topic}`);
    return true;
  } catch (error) {
    console.error(`[FCM] Failed to subscribe to topic ${topic}:`, error);
    return false;
  }
}

/**
 * Unsubscribe a device from a topic
 */
export async function unsubscribeFromTopic(fcmTokens: string[], topic: string): Promise<boolean> {
  if (!messagingClient) {
    console.warn('[FCM] Messaging client not initialized. Cannot unsubscribe from topic.');
    return false;
  }

  try {
    await messagingClient.unsubscribeFromTopic(fcmTokens, topic);
    console.log(`[FCM] Unsubscribed ${fcmTokens.length} devices from topic: ${topic}`);
    return true;
  } catch (error) {
    console.error(`[FCM] Failed to unsubscribe from topic ${topic}:`, error);
    return false;
  }
}

/**
 * Send notification to all devices subscribed to a topic
 */
export async function sendNotificationToTopic(
  topic: string,
  notification: {
    title: string;
    body: string;
    icon?: string;
    badge?: string;
    tag?: string;
    requireInteraction?: boolean;
  },
  data?: Record<string, string>
): Promise<string | null> {
  if (!messagingClient) {
    console.warn('[FCM] Messaging client not initialized. Cannot send to topic.');
    return null;
  }

  try {
    const messageId = await messagingClient.send({
      topic,
      notification: {
        title: notification.title,
        body: notification.body,
      },
      data: {
        ...data,
        icon: notification.icon || '/icon-192x192.png',
        badge: notification.badge || '/badge-72x72.png',
        tag: notification.tag || 'wildlife-guard',
        requireInteraction: notification.requireInteraction ? 'true' : 'false',
      },
      webpush: {
        notification: {
          title: notification.title,
          body: notification.body,
          icon: notification.icon || '/icon-192x192.png',
          badge: notification.badge || '/badge-72x72.png',
          tag: notification.tag || 'wildlife-guard',
          requireInteraction: notification.requireInteraction || false,
          actions: [
            {
              action: 'open',
              title: 'Open',
            },
            {
              action: 'close',
              title: 'Close',
            },
          ],
        },
        fcmOptions: {
          link: data?.actionUrl || '/',
        },
      },
    });

    console.log(`[FCM] Topic notification sent to ${topic}. Message ID: ${messageId}`);
    return messageId;
  } catch (error) {
    console.error(`[FCM] Failed to send to topic ${topic}:`, error);
    return null;
  }
}

/**
 * Get Firebase app instance
 */
export function getFirebaseApp(): admin.app.App | null {
  return firebaseApp;
}

/**
 * Get messaging client
 */
export function getMessagingClient(): admin.messaging.Messaging | null {
  return messagingClient;
}

/**
 * Check if Firebase is initialized
 */
export function isFirebaseInitialized(): boolean {
  return firebaseApp !== null && messagingClient !== null;
}
