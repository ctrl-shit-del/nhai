import { GPSPoint } from '../types';
import { GUARD_THRESHOLDS } from '../config/constants';

export type GPSAccuracyTier = 'GOOD' | 'FAIR' | 'POOR' | 'UNAVAILABLE';

export interface SiteLocation {
  lat: number;
  lng: number;
  radiusM?: number;
}

export function getAccuracyTier(point?: GPSPoint): GPSAccuracyTier {
  if (!point || point.accuracyM <= 0) return 'UNAVAILABLE';
  if (point.accuracyM <= 25) return 'GOOD';
  if (point.accuracyM <= 100) return 'FAIR';
  return 'POOR';
}

export function distanceMeters(left: Pick<GPSPoint, 'lat' | 'lng'>, right: Pick<GPSPoint, 'lat' | 'lng'>): number {
  const earthRadiusM = 6_371_000;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const deltaLat = toRadians(right.lat - left.lat);
  const deltaLng = toRadians(right.lng - left.lng);
  const lat1 = toRadians(left.lat);
  const lat2 = toRadians(right.lat);

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;

  return 2 * earthRadiusM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function isInsideSiteGeofence(point: GPSPoint, site: SiteLocation): boolean {
  const radius = site.radiusM ?? GUARD_THRESHOLDS.gpsSiteRadiusM;
  return distanceMeters(point, site) <= radius;
}
