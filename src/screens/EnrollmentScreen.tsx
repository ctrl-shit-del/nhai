import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  Camera,
  useCameraDevice,
  type CameraPermissionStatus,
} from "react-native-vision-camera";
import { FaceOverlay } from "../components/FaceOverlay";
import { useCameraFrame } from "../hooks/useCameraFrame";
import type { ImageFrame } from "../ml/CLAHEPreprocessor";
import type { GUARDEngineProps, WorkerProfile } from "../types";

// GUARD FIX: S2 — Human-readable enrollment errors
function friendlyEnrollError(raw: string): string {
  if (raw.includes("LOW_QUALITY")) {
    return "Sample rejected: face too small or blurry. Move closer and ensure good lighting.";
  }
  if (raw.includes("NO_FACE")) {
    return "No face detected. Please center your face in the frame.";
  }
  if (raw.includes("three accepted")) {
    return "Please capture all 3 samples before saving.";
  }
  if (raw.includes("must be initialized")) {
    return "App is still loading. Please wait a moment.";
  }
  if (raw.includes("liveness authorization")) {
    return "Supervisor verification required. Please complete liveness check first.";
  }
  return raw;
}

// GUARD FIX: Issue 4 — Stable worker IDs
function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function sanitizeLabourContractId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-_]/g, "");
}

function resolveWorkerId(labourContractId: string): string {
  const sanitized = sanitizeLabourContractId(labourContractId);
  return sanitized.length > 0 ? sanitized : generateUUID();
}

type SampleSlotStatus = "empty" | "good" | "low_quality" | "no_face";

interface SampleSlot {
  frame: ImageFrame | null;
  status: SampleSlotStatus;
  capturedAt?: number;
  hint?: string;
}

const EMPTY_SLOTS: SampleSlot[] = [
  { frame: null, status: "empty" },
  { frame: null, status: "empty" },
  { frame: null, status: "empty" },
];

export function EnrollmentScreen({ engine, isReady = false }: GUARDEngineProps) {
  const [workerName, setWorkerName] = useState("");
  const [labourContractId, setLabourContractId] = useState("");
  const [ppeNotes, setPpeNotes] = useState("");
  const [enrolling, setEnrolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sampleMessage, setSampleMessage] = useState(
    "Align face in frame, then capture each sample (S1–S3).",
  );
  const [slots, setSlots] = useState<SampleSlot[]>(EMPTY_SLOTS);
  const [formFocused, setFormFocused] = useState(false);
  const [permissionStatus, setPermissionStatus] =
    useState<CameraPermissionStatus>("not-determined");
  const [successBanner, setSuccessBanner] = useState<{
    name: string;
    total: number;
  } | null>(null);

  const deviceFront = useCameraDevice("front");
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const engineReady = isReady || engine.isEngineReady();

  const filledCount = slots.filter((s) => s.frame !== null).length;
  const allSamplesReady = filledCount === 3;

  // GUARD FIX: S4 — Pause overlay hints only; keep camera preview active
  const detectionPaused = formFocused || enrolling;

  const {
    device: hookDevice,
    cameraRef,
    frameProcessor,
    captureFrame,
    hasRealFrame,
  } = useCameraFrame(engine.models.blazeface, "front", {
    detectEnabled: !detectionPaused,
    inferenceThrottleMs: 300,
  });

  const device = hookDevice ?? deviceFront;

  // GUARD FIX: Issue 6 — Explicit camera permission lifecycle
  useEffect(() => {
    let mounted = true;

    const syncPermission = async () => {
      try {
        const status = await Camera.getCameraPermissionStatus();
        if (!mounted) return;
        setPermissionStatus(status);

        if (status === "not-determined") {
          const requested = await Camera.requestCameraPermission();
          if (mounted) setPermissionStatus(requested);
        }
      } catch (permError) {
        console.warn("[EnrollmentScreen] Permission check failed", permError);
      }
    };

    syncPermission();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
    };
  }, []);

  const runQualityPrecheck = useCallback(
    async (frame: ImageFrame): Promise<{
      ok: boolean;
      status: SampleSlotStatus;
      hint: string;
    }> => {
      try {
        const processed = engine.preprocessor.preprocess(frame);
        const face = await engine.faceEngine.detectFace(processed);
        const quality = engine.faceEngine.assessQuality(face);

        if (!face || !quality.accepted) {
          const reason = quality.reasons.includes("NO_FACE")
            ? "NO_FACE"
            : "LOW_QUALITY";
          return {
            ok: false,
            status: reason === "NO_FACE" ? "no_face" : "low_quality",
            hint:
              reason === "NO_FACE"
                ? "No face detected"
                : "Low quality — retake",
          };
        }

        return { ok: true, status: "good", hint: "✓ Good" };
      } catch (precheckError) {
        console.warn("[EnrollmentScreen] Precheck failed", precheckError);
        return { ok: true, status: "good", hint: "✓ Captured" };
      }
    },
    [engine],
  );

  // GUARD FIX: Issue 3 — Per-slot capture / retake
  const captureSample = useCallback(
    async (index: 0 | 1 | 2) => {
      if (!engineReady || enrolling) return;

      setError(null);
      const currentFrame = captureFrame();
      const usedReal = hasRealFrame();

      console.log(
        `[EnrollmentScreen] Capture S${index + 1} — realFrame=${usedReal} ${currentFrame.width}x${currentFrame.height}`,
      );

      const precheck = await runQualityPrecheck(currentFrame);

      setSlots((prev) => {
        const next = prev.map((s, i) =>
          i === index
            ? {
                frame: currentFrame,
                status: precheck.status,
                capturedAt: Date.now(),
                hint: precheck.hint,
              }
            : s,
        );
        const captured = next.filter((s) => s.frame !== null).length;

        if (!precheck.ok) {
          setSampleMessage(
            `S${index + 1}: ${precheck.hint}. Tap Retake on S${index + 1} to try again.`,
          );
        } else if (captured < 3) {
          setSampleMessage(
            `${captured}/3 samples ready. Capture or retake remaining slots.`,
          );
        } else {
          setSampleMessage(
            "All 3 samples ready. Enter worker details and tap Save Enrollment.",
          );
        }

        return next;
      });
    },
    [
      engineReady,
      enrolling,
      captureFrame,
      hasRealFrame,
      runQualityPrecheck,
    ],
  );

  const resetSlots = useCallback(() => {
    setSlots(EMPTY_SLOTS.map((s) => ({ ...s })));
    setSampleMessage("Align face in frame, then capture each sample (S1–S3).");
  }, []);

  // GUARD FIX: Issues 4, 5, 7, S1, S2 — Save enrollment
  const saveEnrollment = useCallback(async () => {
    if (!engineReady) {
      Alert.alert("Not ready", "Engine is still initializing. Please wait.");
      return;
    }

    const frames = slots
      .map((s) => s.frame)
      .filter((f): f is ImageFrame => f !== null);

    if (frames.length < 3 || workerName.trim().length === 0) {
      setError(friendlyEnrollError("Enrollment requires three accepted face samples."));
      return;
    }

    const hasBadSlot = slots.some(
      (s) => s.status === "low_quality" || s.status === "no_face",
    );
    if (hasBadSlot) {
      setError("One or more samples failed quality check. Please retake them.");
      return;
    }

    setEnrolling(true);
    setError(null);
    setSuccessBanner(null);

    try {
      const profile: WorkerProfile = {
        workerId: resolveWorkerId(labourContractId),
        workerName: workerName.trim(),
        labourContractId: labourContractId.trim() || undefined,
        ppeNotes: ppeNotes.trim() || undefined,
        enrolledAt: Date.now(),
      };

      console.log(
        `[EnrollmentScreen] enrollWorker start — ${profile.workerName} (${profile.workerId})`,
      );

      await engine.enrollWorker(profile, frames);

      const total = engine.getStats().enrolledWorkers;
      setSuccessBanner({ name: profile.workerName, total });

      if (successTimerRef.current) clearTimeout(successTimerRef.current);
      successTimerRef.current = setTimeout(() => {
        setSuccessBanner(null);
      }, 3000);

      setWorkerName("");
      setLabourContractId("");
      setPpeNotes("");
      resetSlots();

      console.log(
        `[EnrollmentScreen] enrollWorker success — total workers: ${total}`,
      );
    } catch (enrollError) {
      const raw =
        enrollError instanceof Error
          ? enrollError.message
          : "Enrollment failed";
      console.warn("[EnrollmentScreen] enrollWorker failed:", raw);
      setError(friendlyEnrollError(raw));
    } finally {
      setEnrolling(false);
    }
  }, [
    engineReady,
    slots,
    workerName,
    labourContractId,
    ppeNotes,
    engine,
    resetSlots,
  ]);

  const openSettings = useCallback(() => {
    Linking.openSettings().catch(() => {
      Alert.alert("Settings", "Unable to open device settings.");
    });
  }, []);

  const requestPermissionAgain = useCallback(async () => {
    const result = await Camera.requestCameraPermission();
    setPermissionStatus(result);
  }, []);

  const canSave =
    engineReady &&
    allSamplesReady &&
    workerName.trim().length > 0 &&
    !enrolling &&
    !slots.some((s) => s.status === "low_quality" || s.status === "no_face");

  const cameraActive = permissionStatus === "granted" && !enrolling;

  const renderPermissionPane = () => {
    if (permissionStatus === "granted") return null;

    if (permissionStatus === "denied" || permissionStatus === "restricted") {
      return (
        <View style={styles.permissionPane}>
          <Text style={styles.permissionTitle}>Camera access denied</Text>
          <Text style={styles.permissionBody}>
            GUARD needs the front camera to capture face samples for enrollment.
          </Text>
          <Pressable style={styles.permissionButton} onPress={openSettings}>
            <Text style={styles.permissionButtonText}>Open Settings</Text>
          </Pressable>
        </View>
      );
    }

    return (
      <View style={styles.permissionPane}>
        <Text style={styles.permissionTitle}>Camera permission required</Text>
        <Pressable style={styles.permissionButton} onPress={requestPermissionAgain}>
          <Text style={styles.permissionButtonText}>Allow Camera</Text>
        </Pressable>
      </View>
    );
  };

  const renderCamera = () => {
    if (!device) {
      return (
        <Text style={styles.cameraLabel}>Front camera not available on this device.</Text>
      );
    }

    if (permissionStatus !== "granted") {
      return renderPermissionPane();
    }

    return (
      <>
        <Camera
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={cameraActive}
          frameProcessor={frameProcessor}
          pixelFormat="rgb"
        />
        {detectionPaused ? (
          <View style={styles.pauseBadge}>
            <Text style={styles.pauseBadgeText}>Hints paused</Text>
          </View>
        ) : null}
        <FaceOverlay
          prompt={
            allSamplesReady
              ? "All samples captured — fill form below"
              : "Align face within frame"
          }
        />
      </>
    );
  };

  return (
    <View style={styles.screen}>
      {!engineReady ? (
        <View style={styles.initOverlay}>
          <ActivityIndicator color="#2563EB" size="large" />
          <Text style={styles.initText}>Initializing GUARD engine…</Text>
        </View>
      ) : null}

      <View style={styles.cameraPane}>{renderCamera()}</View>

      <View style={styles.form}>
        <Text style={styles.title}>Worker Enrollment</Text>
        <Text style={styles.sampleStatus}>{sampleMessage}</Text>

        {successBanner ? (
          <View style={styles.successBanner}>
            <Text style={styles.successBannerText}>
              ✓ {successBanner.name} enrolled. Total workers on device:{" "}
              {successBanner.total}
            </Text>
          </View>
        ) : null}

        {/* GUARD FIX: Issue 3 — Three independent sample slots */}
        <View style={styles.sampleRow}>
          {([0, 1, 2] as const).map((index) => {
            const slot = slots[index];
            const hasFrame = slot.frame !== null;
            const slotStyle =
              slot.status === "good"
                ? styles.sampleGood
                : slot.status === "low_quality" || slot.status === "no_face"
                  ? styles.sampleRejected
                  : hasFrame
                    ? styles.sampleAccepted
                    : styles.samplePending;

            return (
              <View key={index} style={styles.sampleSlot}>
                <Text style={[styles.sampleLabel, slotStyle]}>
                  {hasFrame
                    ? slot.status === "good"
                      ? `✓ S${index + 1}`
                      : slot.status === "no_face"
                        ? `✗ S${index + 1}`
                        : `⚠ S${index + 1}`
                    : `S${index + 1}`}
                </Text>
                {slot.hint ? (
                  <Text style={styles.sampleHint} numberOfLines={2}>
                    {slot.hint}
                  </Text>
                ) : (
                  <Text style={styles.sampleHint}>Empty</Text>
                )}
                <Pressable
                  style={[
                    styles.slotButton,
                    (!engineReady || enrolling) && styles.disabledButton,
                  ]}
                  disabled={!engineReady || enrolling}
                  onPress={() => captureSample(index)}
                >
                  <Text style={styles.slotButtonText}>
                    {hasFrame ? "Retake" : "Capture"}
                  </Text>
                </Pressable>
              </View>
            );
          })}
        </View>

        <TextInput
          placeholder="Worker name *"
          placeholderTextColor="#6B7280"
          style={styles.input}
          value={workerName}
          onChangeText={setWorkerName}
          editable={engineReady && !enrolling}
          onFocus={() => setFormFocused(true)}
          onBlur={() => setFormFocused(false)}
        />
        <TextInput
          placeholder="Labour contract ID (optional — used as stable worker ID)"
          placeholderTextColor="#6B7280"
          style={styles.input}
          value={labourContractId}
          onChangeText={setLabourContractId}
          editable={engineReady && !enrolling}
          onFocus={() => setFormFocused(true)}
          onBlur={() => setFormFocused(false)}
        />
        <TextInput
          placeholder="PPE notes (helmet, mask, etc.)"
          placeholderTextColor="#6B7280"
          style={styles.input}
          value={ppeNotes}
          onChangeText={setPpeNotes}
          editable={engineReady && !enrolling}
          onFocus={() => setFormFocused(true)}
          onBlur={() => setFormFocused(false)}
        />

        <Pressable
          style={[styles.primaryButton, !canSave && styles.disabledButton]}
          disabled={!canSave}
          onPress={saveEnrollment}
        >
          {enrolling ? (
            <View style={styles.saveRow}>
              <ActivityIndicator color="#FFFFFF" size="small" />
              <Text style={styles.primaryButtonText}>Processing…</Text>
            </View>
          ) : (
            <Text style={styles.primaryButtonText}>Save Enrollment</Text>
          )}
        </Pressable>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: "#F6F8FA",
    flex: 1,
  },
  initOverlay: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.92)",
    bottom: 0,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 20,
  },
  initText: {
    color: "#111827",
    fontSize: 14,
    fontWeight: "600",
    marginTop: 12,
  },
  cameraPane: {
    alignItems: "center",
    backgroundColor: "#111827",
    height: 280,
    justifyContent: "center",
    overflow: "hidden",
  },
  cameraLabel: {
    color: "#9CA3AF",
    fontSize: 13,
    padding: 16,
    textAlign: "center",
  },
  permissionPane: {
    alignItems: "center",
    gap: 12,
    padding: 20,
  },
  permissionTitle: {
    color: "#F9FAFB",
    fontSize: 15,
    fontWeight: "700",
    textAlign: "center",
  },
  permissionBody: {
    color: "#9CA3AF",
    fontSize: 13,
    textAlign: "center",
  },
  permissionButton: {
    backgroundColor: "#2563EB",
    borderRadius: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  permissionButtonText: {
    color: "#FFFFFF",
    fontWeight: "700",
  },
  pauseBadge: {
    backgroundColor: "rgba(15, 23, 42, 0.8)",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    position: "absolute",
    right: 12,
    top: 12,
  },
  pauseBadgeText: {
    color: "#E2E8F0",
    fontSize: 11,
    fontWeight: "700",
  },
  form: {
    flex: 1,
    gap: 10,
    padding: 16,
  },
  title: {
    color: "#111827",
    fontSize: 20,
    fontWeight: "700",
  },
  sampleStatus: {
    color: "#4B5563",
    fontSize: 13,
  },
  successBanner: {
    backgroundColor: "#DCFCE7",
    borderRadius: 6,
    padding: 10,
  },
  successBannerText: {
    color: "#166534",
    fontSize: 13,
    fontWeight: "700",
  },
  sampleRow: {
    flexDirection: "row",
    gap: 8,
  },
  sampleSlot: {
    flex: 1,
    gap: 4,
  },
  sampleLabel: {
    borderRadius: 6,
    fontSize: 12,
    fontWeight: "700",
    padding: 8,
    textAlign: "center",
  },
  samplePending: {
    backgroundColor: "#F3F4F6",
    color: "#9CA3AF",
  },
  sampleAccepted: {
    backgroundColor: "#E0E7FF",
    color: "#3730A3",
  },
  sampleGood: {
    backgroundColor: "#DCFCE7",
    color: "#166534",
  },
  sampleRejected: {
    backgroundColor: "#FEE2E2",
    color: "#B91C1C",
  },
  sampleHint: {
    color: "#6B7280",
    fontSize: 10,
    textAlign: "center",
  },
  slotButton: {
    alignItems: "center",
    borderColor: "#2563EB",
    borderRadius: 6,
    borderWidth: 1,
    paddingVertical: 8,
  },
  slotButtonText: {
    color: "#2563EB",
    fontSize: 12,
    fontWeight: "700",
  },
  input: {
    backgroundColor: "#FFFFFF",
    borderColor: "#D1D5DB",
    borderRadius: 6,
    borderWidth: 1,
    color: "#111827",
    padding: 12,
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#2563EB",
    borderRadius: 6,
    padding: 12,
  },
  saveRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
  disabledButton: {
    opacity: 0.45,
  },
  errorText: {
    color: "#B91C1C",
    fontSize: 13,
    fontWeight: "700",
  },
});
