import Geolocation from '@react-native-community/geolocation';
import { PermissionsAndroid, Platform } from 'react-native';
import type { GPSPoint } from '../types';

export type LocationPermissionStatus =
  | 'granted'
  | 'denied'
  | 'blocked'
  | 'checking';

export type GpsFixSource =
  | 'cached'
  | 'network'
  | 'gps'
  | 'stale'
  | 'unavailable';

export interface AcquiredGps {
  point: GPSPoint;
  source: GpsFixSource;
}

/** Sentinel when no fix could be obtained — attendance may still proceed (PRD). */
export const GPS_UNAVAILABLE: GPSPoint = {
  lat: 0,
  lng: 0,
  accuracyM: 0,
  capturedAt: 0,
};

export function isGpsValid(point: GPSPoint | null | undefined): boolean {
  if (!point) return false;
  if (point.accuracyM <= 0) return false;
  if (point.lat === 0 && point.lng === 0) return false;
  return Number.isFinite(point.lat) && Number.isFinite(point.lng);
}

export async function checkLocationPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const fine = await PermissionsAndroid.check(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
  );
  if (fine) return true;
  return PermissionsAndroid.check(
    PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
  );
}

/** Request runtime location permission (Android). iOS prompts on first GPS use. */
export async function ensureLocationPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    if (Platform.OS === 'ios' && typeof Geolocation.requestAuthorization === 'function') {
      return new Promise((resolve) => {
        Geolocation.requestAuthorization(
          () => resolve(true),
          () => resolve(false),
        );
      });
    }
    return true;
  }

  if (await checkLocationPermission()) return true;

  const results = await PermissionsAndroid.requestMultiple([
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
  ]);

  return (
    results[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] ===
      PermissionsAndroid.RESULTS.GRANTED ||
    results[PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION] ===
      PermissionsAndroid.RESULTS.GRANTED
  );
}

export function positionToGpsPoint(position: {
  coords: { latitude: number; longitude: number; accuracy?: number };
}): GPSPoint {
  return {
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    accuracyM: position.coords.accuracy ?? 0,
    capturedAt: Date.now(),
  };
}

function tryGetCurrentPosition(
  enableHighAccuracy: boolean,
  timeoutMs: number,
  maximumAge: number,
): Promise<GPSPoint | null> {
  return new Promise((resolve) => {
    Geolocation.getCurrentPosition(
      (position) => resolve(positionToGpsPoint(position)),
      () => resolve(null),
      { enableHighAccuracy, timeout: timeoutMs, maximumAge },
    );
  });
}

/**
 * Best-effort GPS for attendance — tries network/cell first (works indoors),
 * then high-accuracy GPS, then stale cache. Returns GPS_UNAVAILABLE if all fail.
 */
export async function acquireGpsForAttendance(
  cached?: GPSPoint | null,
): Promise<AcquiredGps> {
  if (isGpsValid(cached)) {
    return { point: cached!, source: 'cached' };
  }

  // Network / Wi‑Fi / cell — usually fastest indoors
  const networkFix = await tryGetCurrentPosition(false, 10_000, 300_000);
  if (isGpsValid(networkFix)) {
    return { point: networkFix!, source: 'network' };
  }

  // High-accuracy satellite GPS — needs clear sky
  const gpsFix = await tryGetCurrentPosition(true, 20_000, 60_000);
  if (isGpsValid(gpsFix)) {
    return { point: gpsFix!, source: 'gps' };
  }

  // Any cached system location up to 24 h old
  const staleFix = await tryGetCurrentPosition(false, 5_000, 86_400_000);
  if (isGpsValid(staleFix)) {
    return { point: staleFix!, source: 'stale' };
  }

  return {
    point: { ...GPS_UNAVAILABLE, capturedAt: Date.now() },
    source: 'unavailable',
  };
}

/** @deprecated Prefer acquireGpsForAttendance */
export function getCurrentGpsFix(timeoutMs = 15000): Promise<GPSPoint> {
  return acquireGpsForAttendance().then((result) => {
    if (isGpsValid(result.point)) return result.point;
    throw new Error('Location request timed out');
  });
}

export function watchGps(
  onUpdate: (point: GPSPoint) => void,
  onError: (message: string) => void,
): number {
  return Geolocation.watchPosition(
    (position) => {
      const point = positionToGpsPoint(position);
      if (isGpsValid(point)) onUpdate(point);
    },
    (error) => onError(error.message || 'GPS watch failed'),
    {
      enableHighAccuracy: false,
      distanceFilter: 25,
      interval: 5000,
      maximumAge: 120_000,
    },
  );
}
