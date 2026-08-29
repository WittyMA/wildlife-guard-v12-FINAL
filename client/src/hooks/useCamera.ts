/**
 * Hook for managing camera access and live feed
 * Handles permissions, stream management, and error handling
 */

import { useEffect, useRef, useState } from 'react';

export interface CameraPermissionState {
  status: 'idle' | 'requesting' | 'granted' | 'denied' | 'error';
  error?: string;
}

export interface UseCameraOptions {
  width?: number;
  height?: number;
  facingMode?: 'user' | 'environment';
  onError?: (error: Error) => void;
  useDroneStream?: boolean;
  droneStreamUrl?: string;
}

export function useCamera(videoRef: React.RefObject<HTMLVideoElement>, options: UseCameraOptions = {}) {
  const [permissionState, setPermissionState] = useState<CameraPermissionState>({
    status: 'idle',
  });
  const [isStreaming, setIsStreaming] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const [isDroneStream, setIsDroneStream] = useState(options.useDroneStream || false);

  const {
    width = 1280,
    height = 720,
    facingMode = 'environment',
    onError,
    droneStreamUrl = 'http://localhost:5000/video_feed',
  } = options;

  const requestPermissions = async () => {
    setPermissionState({ status: 'requesting' });

    if (isDroneStream) {
      // For drone stream, we don't need camera permissions, just set the source
      if (videoRef.current) {
        // We use an img tag approach for MJPEG streams, but if we must use video tag,
        // we need to handle it differently or rely on the component to render an img instead
        // For now, we'll just set the state to granted
        setIsStreaming(true);
        setPermissionState({ status: 'granted' });
      }
      return true;
    }

    try {
      // Check if camera permission is already granted
      const permission = await navigator.permissions.query({ name: 'camera' as PermissionName });

      if (permission.state === 'denied') {
        setPermissionState({
          status: 'denied',
          error: 'Camera permission denied. Please enable it in browser settings.',
        });
        return false;
      }

      // Request camera access
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: width },
          height: { ideal: height },
          facingMode,
        },
        audio: false,
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        streamRef.current = stream;
        setIsStreaming(true);
        setPermissionState({ status: 'granted' });
      }

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to access camera';
      setPermissionState({
        status: 'error',
        error: message,
      });
      onError?.(error instanceof Error ? error : new Error(message));
      return false;
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    
    setIsStreaming(false);
  };

  const switchCamera = async (newFacingMode: 'user' | 'environment') => {
    if (isDroneStream) return; // Cannot switch facing mode on drone
    stopCamera();
    await requestPermissions();
  };

  const toggleDroneStream = async (useDrone: boolean) => {
    stopCamera();
    setIsDroneStream(useDrone);
    // The actual stream connection will be handled by the component
    // calling requestPermissions again or rendering an img tag
  };

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  return {
    permissionState,
    isStreaming,
    requestPermissions,
    stopCamera,
    switchCamera,
    toggleDroneStream,
    isDroneStream,
    droneStreamUrl,
    stream: streamRef.current,
  };
}

/**
 * Hook for Screen Wake Lock API
 * Keeps the screen on while monitoring
 */
export function useScreenWakeLock() {
  const [isActive, setIsActive] = useState(false);
  const wakeLockRef = useRef<any>(null);

  const request = async () => {
    try {
      if ('wakeLock' in navigator) {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
        setIsActive(true);

        // Handle wake lock release
        wakeLockRef.current.addEventListener('release', () => {
          setIsActive(false);
        });

        return true;
      } else {
        console.warn('Screen Wake Lock API not supported');
        return false;
      }
    } catch (error) {
      console.error('Failed to request wake lock:', error);
      return false;
    }
  };

  const release = async () => {
    if (wakeLockRef.current) {
      await wakeLockRef.current.release();
      wakeLockRef.current = null;
      setIsActive(false);
    }
  };

  useEffect(() => {
    // Re-request wake lock if page becomes visible
    const handleVisibilityChange = async () => {
      if (!document.hidden && isActive && !wakeLockRef.current) {
        await request();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isActive]);

  return {
    isActive,
    request,
    release,
  };
}

/**
 * Hook for Notification API integration
 */
export function useNotifications() {
  const [permissionState, setPermissionState] = useState<NotificationPermission>(
    Notification.permission
  );

  const requestPermission = async () => {
    if (!('Notification' in window)) {
      console.warn('Notification API not supported');
      return false;
    }

    try {
      const permission = await Notification.requestPermission();
      setPermissionState(permission);
      return permission === 'granted';
    } catch (error) {
      console.error('Failed to request notification permission:', error);
      return false;
    }
  };

  const sendNotification = (title: string, options?: NotificationOptions) => {
    if (permissionState === 'granted') {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then((registration) => {
          registration.showNotification(title, options);
        });
      } else {
        new Notification(title, options);
      }
    }
  };

  return {
    permissionState,
    requestPermission,
    sendNotification,
  };
}
