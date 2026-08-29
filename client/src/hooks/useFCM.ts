import { useEffect, useState } from 'react';
import { trpc } from '@/lib/trpc';

/**
 * Hook for managing FCM token registration and notification permissions
 * Handles:
 * - Requesting notification permission
 * - Acquiring FCM token from service worker
 * - Registering token with backend
 * - Unregistering on logout
 */
export function useFCM() {
  const [fcmToken, setFcmToken] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permissionStatus, setPermissionStatus] = useState<NotificationPermission>('default');

  const registerTokenMutation = trpc.fcm.registerToken.useMutation();
  const unregisterTokenMutation = trpc.fcm.unregisterToken.useMutation();
  const isInitializedQuery = trpc.fcm.isInitialized.useQuery();

  /**
   * Request notification permission from user
   */
  const requestPermission = async (): Promise<boolean> => {
    if (!('Notification' in window)) {
      setError('Notifications not supported in this browser');
      return false;
    }

    if (Notification.permission === 'granted') {
      return true;
    }

    if (Notification.permission === 'denied') {
      setError('Notification permission denied');
      return false;
    }

    try {
      const permission = await Notification.requestPermission();
      setPermissionStatus(permission);

      if (permission === 'granted') {
        return true;
      } else {
        setError('Notification permission not granted');
        return false;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to request permission';
      setError(message);
      console.error('[FCM] Permission request failed:', err);
      return false;
    }
  };

  /**
   * Get FCM token from service worker
   */
  const getFCMToken = async (): Promise<string | null> => {
    if (!('serviceWorker' in navigator)) {
      setError('Service Workers not supported');
      return null;
    }

    try {
      const registration = await navigator.serviceWorker.ready;

      // Try to get token from service worker message
      return new Promise((resolve) => {
        const channel = new MessageChannel();

        const handleMessage = (event: MessageEvent) => {
          if (event.data.type === 'FCM_TOKEN') {
            channel.port1.onmessage = null;
            resolve(event.data.token || null);
          }
        };

        channel.port1.onmessage = handleMessage;

        // Request token from service worker
        registration.active?.postMessage(
          { type: 'GET_FCM_TOKEN' },
          [channel.port2]
        );

        // Timeout after 5 seconds
        setTimeout(() => {
          channel.port1.onmessage = null;
          resolve(null);
        }, 5000);
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to get FCM token';
      setError(message);
      console.error('[FCM] Failed to get token:', err);
      return null;
    }
  };

  /**
   * Register FCM token with backend
   */
  const registerToken = async (token: string): Promise<boolean> => {
    if (!token) {
      setError('No FCM token available');
      return false;
    }

    try {
      const deviceId = `${navigator.userAgent}-${Date.now()}`;
      const deviceName = getDeviceName();

      const result = await registerTokenMutation.mutateAsync({
        fcmToken: token,
        deviceId,
        deviceName,
      });

      if (result.success) {
        setFcmToken(token);
        setError(null);
        console.log('[FCM] Token registered successfully');
        return true;
      } else {
        setError(result.message || 'Failed to register token');
        return false;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to register token';
      setError(message);
      console.error('[FCM] Registration failed:', err);
      return false;
    }
  };

  /**
   * Unregister FCM token on logout
   */
  const unregisterToken = async (token: string): Promise<boolean> => {
    if (!token) {
      return false;
    }

    try {
      const result = await unregisterTokenMutation.mutateAsync({
        fcmToken: token,
      });

      if (result.success) {
        setFcmToken(null);
        console.log('[FCM] Token unregistered successfully');
        return true;
      }
      return false;
    } catch (err) {
      console.error('[FCM] Unregistration failed:', err);
      return false;
    }
  };

  /**
   * Initialize FCM - request permission and register token
   */
  const initialize = async (): Promise<boolean> => {
    if (isInitialized) {
      return !!fcmToken;
    }

    try {
      // Check if Firebase is initialized
      if (!isInitializedQuery.data?.initialized) {
        setError('Firebase not initialized');
        return false;
      }

      // Request notification permission
      const hasPermission = await requestPermission();
      if (!hasPermission) {
        return false;
      }

      // Get FCM token
      const token = await getFCMToken();
      if (!token) {
        setError('Failed to acquire FCM token');
        return false;
      }

      // Register token with backend
      const registered = await registerToken(token);
      if (!registered) {
        return false;
      }

      setIsInitialized(true);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Initialization failed';
      setError(message);
      console.error('[FCM] Initialization failed:', err);
      return false;
    }
  };

  /**
   * Get device name for display
   */
  const getDeviceName = (): string => {
    const ua = navigator.userAgent;

    if (ua.includes('Windows')) return 'Windows Device';
    if (ua.includes('Mac')) return 'Mac Device';
    if (ua.includes('iPhone')) return 'iPhone';
    if (ua.includes('iPad')) return 'iPad';
    if (ua.includes('Android')) return 'Android Device';
    if (ua.includes('Linux')) return 'Linux Device';

    return 'Unknown Device';
  };

  /**
   * Check if notifications are supported and enabled
   */
  const isSupported = (): boolean => {
    return (
      'Notification' in window &&
      'serviceWorker' in navigator &&
      isInitializedQuery.data?.initialized === true
    );
  };

  return {
    fcmToken,
    isInitialized,
    error,
    permissionStatus,
    isSupported: isSupported(),
    initialize,
    requestPermission,
    registerToken,
    unregisterToken,
    isLoading:
      registerTokenMutation.isPending ||
      unregisterTokenMutation.isPending ||
      isInitializedQuery.isLoading,
  };
}

/**
 * Hook for sending test notifications
 */
export function useSendTestNotification() {
  const mutation = trpc.fcm.sendTestNotification.useMutation();

  const sendTest = async (): Promise<boolean> => {
    try {
      const result = await mutation.mutateAsync();
      return result.success;
    } catch (err) {
      console.error('[FCM] Failed to send test notification:', err);
      return false;
    }
  };

  return {
    sendTest,
    isLoading: mutation.isPending,
    error: mutation.error?.message,
    result: mutation.data,
  };
}

/**
 * Hook for sending critical detection alerts
 */
export function useSendCriticalDetectionAlert() {
  const mutation = trpc.fcm.sendCriticalDetectionAlert.useMutation();

  const sendAlert = async (
    detectionType: 'human' | 'animal' | 'vehicle',
    confidence: number,
    stationName: string,
    stationId: string,
    latitude?: number,
    longitude?: number,
    imageUrl?: string
  ): Promise<boolean> => {
    try {
      const result = await mutation.mutateAsync({
        detectionType,
        confidence,
        stationName,
        stationId,
        latitude,
        longitude,
        imageUrl,
      });
      return result.success;
    } catch (err) {
      console.error('[FCM] Failed to send critical detection alert:', err);
      return false;
    }
  };

  return {
    sendAlert,
    isLoading: mutation.isPending,
    error: mutation.error?.message,
  };
}

/**
 * Hook for sending drone deployment alerts
 */
export function useSendDroneDeployedAlert() {
  const mutation = trpc.fcm.sendDroneDeployedAlert.useMutation();

  const sendAlert = async (
    missionId: string,
    stationName: string,
    latitude?: number,
    longitude?: number
  ): Promise<boolean> => {
    try {
      const result = await mutation.mutateAsync({
        missionId,
        stationName,
        latitude,
        longitude,
      });
      return result.success;
    } catch (err) {
      console.error('[FCM] Failed to send drone deployed alert:', err);
      return false;
    }
  };

  return {
    sendAlert,
    isLoading: mutation.isPending,
    error: mutation.error?.message,
  };
}

/**
 * Hook for sending drone completion alerts
 */
export function useSendDroneCompletedAlert() {
  const mutation = trpc.fcm.sendDroneCompletedAlert.useMutation();

  const sendAlert = async (
    missionId: string,
    verificationResult: 'confirmed' | 'false_alarm' | 'inconclusive',
    stationName: string
  ): Promise<boolean> => {
    try {
      const result = await mutation.mutateAsync({
        missionId,
        verificationResult,
        stationName,
      });
      return result.success;
    } catch (err) {
      console.error('[FCM] Failed to send drone completed alert:', err);
      return false;
    }
  };

  return {
    sendAlert,
    isLoading: mutation.isPending,
    error: mutation.error?.message,
  };
}
