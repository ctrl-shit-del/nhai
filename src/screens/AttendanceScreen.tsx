import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Geolocation from "@react-native-community/geolocation";
import { Camera } from "react-native-vision-camera";
import { FaceOverlay } from "../components/FaceOverlay";
import { useCameraFrame } from "../hooks/useCameraFrame";
import { getAccuracyTier } from "../utils/GPSHelper";
import {
  acquireGpsForAttendance,
  ensureLocationPermission,
  isGpsValid,
  watchGps,
  type GpsFixSource,
  type LocationPermissionStatus,
} from "../utils/locationService";
import type {
  AttendanceOutcome,
  GPSPoint,
  GUARDEngineProps,
  LivenessSession,
} from "../types";

const CameraView = Camera as any;

type AttendanceStatus =
  | "idle"
  | "liveness"
  | "processing"
  | "success"
  | "failed"
  | "spoof";

const yieldToUI = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function gpsStatusLabel(
  gps: GPSPoint | null,
  permission: LocationPermissionStatus,
  source: GpsFixSource | null,
): string {
  if (permission === "checking") return "Checking location permission…";
  if (permission === "denied" || permission === "blocked") {
    return "Location permission required for attendance.";
  }
  if (!isGpsValid(gps)) {
    return "GPS unavailable — attendance will proceed without coordinates.";
  }
  const tier = getAccuracyTier(gps);
  const via = source === "network" ? " (network)" : source === "stale" ? " (cached)" : "";
  return `GPS ${tier.toLowerCase()}${via} · ±${Math.round(gps!.accuracyM)} m`;
}

export function AttendanceScreen({ engine }: GUARDEngineProps) {
  const [status, setStatus] = useState<AttendanceStatus>("idle");
  const [livenessSession, setLivenessSession] =
    useState<LivenessSession | null>(null);
  const [outcome, setOutcome] = useState<AttendanceOutcome | null>(null);
  const [gps, setGps] = useState<GPSPoint | null>(null);
  const [locationPermission, setLocationPermission] =
    useState<LocationPermissionStatus>("checking");
  const [gpsSource, setGpsSource] = useState<GpsFixSource | null>(null);
  const [chainLength, setChainLength] = useState(engine.getStats().chainLength);
  const [message, setMessage] = useState(
    "Point camera at your face to mark attendance.",
  );

  const gpsRef = useRef<GPSPoint | null>(null);

  const {
    hasPermission: hasCameraPermission,
    requestPermission: requestCameraPermission,
    device,
    cameraRef,
    captureFrame,
  } = useCameraFrame(engine.models.blazeface, "front", {
    preferSnapshot: true,
  });

  // Keep ref in sync for async callbacks
  useEffect(() => {
    gpsRef.current = gps;
  }, [gps]);

  // ── Location permission + continuous GPS watch ───────────────────────────
  useEffect(() => {
    let watchId: number | null = null;
    let mounted = true;

    const startGps = async () => {
      setLocationPermission("checking");
      const granted = await ensureLocationPermission();
      if (!mounted) return;

      if (!granted) {
        setLocationPermission(
          Platform.OS === "android" ? "denied" : "denied",
        );
        setMessage("Location permission required. Enable it to mark attendance.");
        return;
      }

      setLocationPermission("granted");

      watchId = watchGps(
        (point) => {
          if (mounted) {
            setGps(point);
            setGpsSource("network");
          }
        },
        (gpsError) => {
          console.warn("[AttendanceScreen] GPS watch error:", gpsError);
        },
      );

      const primed = await acquireGpsForAttendance();
      if (mounted && isGpsValid(primed.point)) {
        setGps(primed.point);
        setGpsSource(primed.source);
      } else if (mounted) {
        console.warn("[AttendanceScreen] Initial GPS unavailable — indoor/network only");
      }
    };

    startGps();

    return () => {
      mounted = false;
      if (watchId != null) {
        Geolocation.clearWatch(watchId);
      }
    };
  }, []);

  useEffect(() => {
    if (status !== "success") return undefined;
    const timer = setTimeout(() => {
      setStatus("idle");
      setOutcome(null);
      setLivenessSession(null);
      setMessage("Point camera at your face to mark attendance.");
    }, 3_000);
    return () => clearTimeout(timer);
  }, [status]);

  useEffect(() => {
    if (!hasCameraPermission) requestCameraPermission();
  }, [hasCameraPermission, requestCameraPermission]);

  const resolveGpsFix = useCallback(async () => {
    const granted = await ensureLocationPermission();
    if (!granted) {
      setLocationPermission("denied");
      return null;
    }
    setLocationPermission("granted");

    const acquired = await acquireGpsForAttendance(gpsRef.current);
    setGps(acquired.point);
    setGpsSource(acquired.source);
    gpsRef.current = acquired.point;

    if (acquired.source === "unavailable") {
      console.warn("[AttendanceScreen] No GPS fix — proceeding without coordinates");
    }

    return acquired;
  }, []);

  const openLocationSettings = useCallback(() => {
    Linking.openSettings().catch(() => {
      setMessage("Unable to open device settings.");
    });
  }, []);

  const beginAttendance = useCallback(() => {
    if (locationPermission !== "granted") {
      setMessage("Location permission required before marking attendance.");
      return;
    }

    const session = engine.livenessDetector.createSession();
    setOutcome(null);
    setLivenessSession(session);
    setStatus("liveness");
    setMessage(`Liveness check: ${session.challenges.join(", ")}`);
  }, [engine, locationPermission]);

  const completeChallenge = useCallback(async () => {
    if (!livenessSession || status === "processing") return;

    setStatus("processing");
    setMessage("Processing liveness and recognition…");
    await yieldToUI();

    try {
      const activeSession = engine.livenessDetector.evaluateActive(
        livenessSession,
        livenessSession.challenges,
      );

      await yieldToUI();

      const currentFrame = await captureFrame();

      setMessage("Acquiring location…");
      const acquired = await resolveGpsFix();
      if (!acquired) {
        setStatus("failed");
        setMessage(
          "Location permission denied. Enable location in Settings and try again.",
        );
        return;
      }

      const nextOutcome = await engine.markAttendance(
        currentFrame,
        acquired.point,
        activeSession,
      );
      setOutcome(nextOutcome);

      if (nextOutcome.status === "COMMITTED") {
        setStatus("success");
        setChainLength(engine.getStats().chainLength);
        const gpsNote =
          acquired.source === "unavailable"
            ? " (no GPS — recorded without coordinates)"
            : "";
        setMessage(
          `${nextOutcome.record?.workerName ?? nextOutcome.recognition?.workerName ?? "Worker"} ` +
            `marked at ${Math.round((nextOutcome.recognition?.confidence ?? 0) * 100)}% confidence${gpsNote}.`,
        );
      } else if (nextOutcome.reason === "OUTSIDE_GEOFENCE") {
        setStatus("failed");
        setMessage(
          "Worker is outside the site geofence radius (500 m). Attendance rejected.",
        );
      } else if (
        nextOutcome.reason === "LIVENESS_FAILED" ||
        nextOutcome.reason === "LIVENESS_TIMEOUT"
      ) {
        setStatus("spoof");
        setMessage(
          "Liveness check failed. Ensure good lighting and look at the camera directly, then try again.",
        );
      } else {
        setStatus("failed");
        setMessage(nextOutcome.reason ?? "Review required");
      }
    } catch (attendanceError) {
      setStatus("failed");
      setMessage(
        attendanceError instanceof Error
          ? attendanceError.message
          : "Attendance failed",
      );
    }
  }, [
    livenessSession,
    status,
    engine,
    captureFrame,
    resolveGpsFix,
  ]);

  const prompt = livenessSession
    ? livenessSession.challenges.join(", ")
    : "Align face within frame";

  const gpsLabel = gpsStatusLabel(gps, locationPermission, gpsSource);
  const canMark =
    locationPermission === "granted" &&
    status !== "processing" &&
    status !== "success";

  return (
    <View style={styles.screen}>
      <View style={styles.cameraPane}>
        {device && hasCameraPermission ? (
          <CameraView
            ref={cameraRef as any}
            style={StyleSheet.absoluteFill}
            device={device}
            isActive={status !== "success"}
            photo
            video
          />
        ) : (
          <Text style={styles.cameraLabel}>
            {hasCameraPermission ? "Loading camera…" : "Camera permission required"}
          </Text>
        )}
        <FaceOverlay prompt={prompt} spoofWarning={status === "spoof"} />
      </View>

      <View style={styles.panel}>
        <Text style={styles.title}>Attendance</Text>
        <Text
          style={[
            styles.gpsStatus,
            locationPermission !== "granted" ? styles.gpsWarn : null,
          ]}
        >
          {gpsLabel}
        </Text>
        <Text
          style={[styles.body, status === "spoof" ? styles.spoofText : null]}
        >
          {message}
        </Text>

        {locationPermission === "denied" ? (
          <Pressable style={styles.secondaryButton} onPress={openLocationSettings}>
            <Text style={styles.secondaryButtonText}>Open Settings</Text>
          </Pressable>
        ) : null}

        {outcome?.status === "COMMITTED" ? (
          <Text style={styles.body}>
            {outcome.record?.workerName} · Confidence{" "}
            {Math.round((outcome.recognition?.confidence ?? 0) * 100)}%
          </Text>
        ) : null}

        <Text style={styles.counter}>Chain records: {chainLength}</Text>

        {status === "liveness" ? (
          <Pressable
            style={styles.primaryButton}
            disabled={status === "processing"}
            onPress={completeChallenge}
          >
            <Text style={styles.primaryButtonText}>Complete Challenge</Text>
          </Pressable>
        ) : (
          <Pressable
            style={[
              styles.primaryButton,
              !canMark ? styles.disabledButton : null,
            ]}
            disabled={!canMark}
            onPress={beginAttendance}
          >
            <Text style={styles.primaryButtonText}>
              {status === "processing" ? "Processing…" : "Mark Attendance"}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: "#F6F8FA",
    flex: 1,
  },
  cameraPane: {
    alignItems: "center",
    backgroundColor: "#111827",
    flex: 1,
    justifyContent: "center",
    minHeight: 420,
    overflow: "hidden",
  },
  cameraLabel: {
    color: "#9CA3AF",
    fontSize: 13,
  },
  panel: {
    backgroundColor: "#FFFFFF",
    gap: 10,
    padding: 16,
  },
  title: {
    color: "#111827",
    fontSize: 20,
    fontWeight: "700",
  },
  gpsStatus: {
    color: "#059669",
    fontSize: 12,
    fontWeight: "700",
  },
  gpsWarn: {
    color: "#B45309",
  },
  body: {
    color: "#4B5563",
    fontSize: 14,
  },
  counter: {
    color: "#111827",
    fontSize: 13,
    fontWeight: "700",
  },
  disabledButton: {
    backgroundColor: "#93C5FD",
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#2563EB",
    borderRadius: 6,
    padding: 12,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
  secondaryButton: {
    alignItems: "center",
    borderColor: "#2563EB",
    borderRadius: 6,
    borderWidth: 1,
    padding: 10,
  },
  secondaryButtonText: {
    color: "#2563EB",
    fontSize: 14,
    fontWeight: "700",
  },
  spoofText: {
    color: "#B91C1C",
    fontWeight: "800",
  },
});
