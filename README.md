# GUARD

Geo-locked Unified Attendance & Recognition for Datalake.

GUARD is an offline-first React Native app/module for NHAI and EPC construction-site attendance. It is designed for low-connectivity field conditions where supervisors must enroll workers, mark attendance, keep tamper-evident local records, and sync verified records only after connectivity returns.

The app combines:

- Local worker enrollment and recognition flow
- Active and passive liveness checks
- GPS-backed attendance records
- Site/device-specific SHA256 Merkle chain audit log
- MMKV-backed embedding persistence
- Signed, chunked sync batches with ACK-gated purge behavior
- A React Navigation app shell with five screens
- Android and iOS native project scaffolding

## Current Status

This repository now contains a runnable React Native app scaffold, not just a TypeScript module. It includes:

- `index.js` React Native entry point
- `app.json` app registration metadata
- `App.tsx` demo navigation shell
- Native Android and iOS project folders
- Real non-empty TFLite model binaries
- GUARD engine, screens, hooks, storage, sync, and chain logic

It is ready for code review, TypeScript verification, and native build execution in a properly configured React Native environment. It is not yet a full production biometric system: Vision Camera frame processors, real model inference wiring, hardware-backed encryption, AWS server verification, and measured field benchmarks remain future integration work.

## What Is Implemented

| Area | Status |
|---|---|
| React Native entry | `index.js` registers the app component from `app.json`; Metro can resolve the app entry point. |
| App identity | Android app name is `GUARD`; Android namespace and `applicationId` are `com.guard.datalake`. |
| App shell | `App.tsx` initializes GUARD, mounts all five screens in a native-stack navigator, and shows reconnect sync status. |
| Native permissions | Android declares camera/location permissions. iOS declares camera and location usage descriptions. |
| Engine facade | `GUARDEngine` exposes enrollment, attendance, stats, sync, chain audit, and screen components behind one API. |
| Screens | Dashboard, Attendance, Enrollment, Chain Audit, and Sync screens accept an engine prop and call engine methods. |
| Device ID | `DeviceInfo.ts` uses `react-native-device-info` so chain records use the actual device ID instead of `unknown-device`. |
| Network monitor | `useNetworkMonitor` uses `NetInfo.addEventListener()` and unsubscribes correctly. |
| Hashing | Chain and sync hashing use real SHA256/HMAC-SHA256 through `crypto-js`. |
| Enrollment | Captures three mock samples, builds `WorkerProfile`, calls `engine.enrollWorker()`, and persists transformed embeddings. |
| Liveness | Active randomized challenge sessions exist. Passive liveness uses a multi-signal heuristic until MiniFAS is wired. |
| Recognition | Current `FaceEngine` is deterministic and local, with CLAHE preprocessing, normalized embeddings, cosine matching, and confidence tiers. |
| Merkle chain | Attendance and spoof incident records are chained, locally verifiable, and site/device-specific. |
| Sync | Creates 50-record signed batches, validates mock ACKs, marks records synced, and purges only after ACK timing rules. |
| Model assets | `blazeface.tflite`, `mobilefacenet.tflite`, and `minifas.tflite` are real non-empty TFLite binaries and are copied into Android assets. |
| Benchmarks doc | `docs/BENCHMARKS.md` contains planning estimates and the validation checklist for physical-device runs. |

## What Is Still Pending

| Area | Remaining work |
|---|---|
| Camera | Replace mock `ImageFrame` objects with `react-native-vision-camera` frame processors. |
| ML inference wiring | Real model binaries are present, but `FaceEngine` still uses deterministic TypeScript logic. Wire BlazeFace, MobileFaceNet, MediaPipe landmarks, and MiniFAS through `react-native-fast-tflite`. |
| Passive liveness | Replace heuristic scoring with MiniFAS model output. |
| Active liveness | Replace simulated challenge completion with EAR/MAR/head-pose landmark checks. |
| Security hardening | Bind embeddings and chain storage to hardware-backed keys and production encrypted storage. |
| Backend | Implement `/v1/attendance/sync`, server-side chain verification, Datalake DB commit, and signed server ACKs. |
| Resumable sync | Add pending batch IDs, interrupted upload resume, ACK-loss recovery, and active-sync conflict logging. |
| Field validation | Run measured benchmarks on physical devices with final model inference enabled. |

## Project Structure

```text
index.js                        React Native entry point
app.json                        Registered app name and display name
App.tsx                         App navigation shell
android/                        Android native project, app id com.guard.datalake
ios/                            iOS native project with camera/location usage strings
src/GUARD.ts                    Public exports
src/config/GUARDEngine.ts       Main facade used by host apps
src/screens/                    Dashboard, Attendance, Enrollment, Chain Audit, Sync
src/hooks/                      Engine and network hooks
src/ml/                         Preprocessing, face engine, liveness detector
src/security/                   Embedding store and Merkle chain
src/storage/                    Chain persistence adapter
src/sync/                       Batch creation, ACK validation, purge flow
src/types/                      Public data contracts
src/utils/                      Device, GPS, hash helpers
docs/                           Integration guide and benchmark notes
models/                         TFLite model binaries and model notes
PRD.md                          Product requirements document
```

## Prerequisites

Use a React Native development environment compatible with React Native `0.74`.

Required tools:

- Node.js 18 or newer
- npm 9 or newer
- Java 17 for Android builds
- Android Studio with Android SDK and an emulator or physical Android device
- Xcode and CocoaPods for iOS builds, if running on iOS

Android builds require `JAVA_HOME` to point at a Java 17 JDK. Example:

```sh
export JAVA_HOME=/path/to/jdk-17
export PATH="$JAVA_HOME/bin:$PATH"
```

## Install Dependencies

From the repository root:

```sh
npm install
```

For iOS:

```sh
cd ios
pod install
cd ..
```

## Verify the Code

Run TypeScript compilation:

```sh
npm run typecheck
```

This passes in the current checkout.

Run linting if the host environment has ESLint configured:

```sh
npm run lint
```

Validate model files are present and non-empty:

```sh
ls -lh models/*.tflite android/app/src/main/assets/models/*.tflite
```

Expected approximate sizes:

```text
blazeface.tflite       224 KB
mobilefacenet.tflite   5.0 MB
minifas.tflite         5.8 MB
```

## Run the App

Start Metro:

```sh
npx react-native start
```

Run Android in another terminal:

```sh
npx react-native run-android
```

Or build Android directly:

```sh
cd android
./gradlew assembleDebug
```

Android build note: the last build attempt in this environment could not proceed because `JAVA_HOME` was not set and no `java` binary was available on `PATH`. Set Java 17 first.

Run iOS after installing pods:

```sh
npx react-native run-ios
```

## Demo Walkthrough

Use this sequence for a professional demo:

1. Launch the app.
2. Confirm the top status bar shows device/network state.
3. Open `Enrollment`.
4. Enter a worker name, labour contract ID, and PPE notes.
5. Tap `Capture Sample` three times.
6. Tap `Save Enrollment`.
7. Return to `Dashboard` and confirm worker count updates after refresh.
8. Open `Attendance`.
9. Tap `Mark Attendance`.
10. Tap `Complete Challenge`.
11. Confirm success or review-required state and chain record count.
12. Open `Chain Audit`.
13. Tap `Verify Integrity` and confirm `Valid`, checked record count, genesis hash, tail hash, and last records.
14. Open `Sync`.
15. Tap `Start Manual Sync`.
16. Confirm synced/purged result.
17. Toggle network connectivity off and back on to demonstrate the auto-sync-on-reconnect status path.

## Integrate Into Datalake Navigation

If the host app already initializes authentication, site selection, and navigation, mount the GUARD screens with an initialized engine:

```tsx
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useGUARDEngine } from './src/hooks/useGUARDEngine';
import { AttendanceScreen } from './src/screens/AttendanceScreen';
import { ChainAuditScreen } from './src/screens/ChainAuditScreen';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { EnrollmentScreen } from './src/screens/EnrollmentScreen';
import { SyncScreen } from './src/screens/SyncScreen';

const Stack = createNativeStackNavigator();

export function GuardModule({ siteId, deviceId, token }: { siteId: string; deviceId: string; token: string }) {
  const { engine, isReady, error } = useGUARDEngine({
    siteId,
    deviceId,
    datalakeAuthToken: token,
    requireSupervisorLivenessForEnrollment: false,
    allowLowConfidenceCommit: true
  });

  if (error) return null;
  if (!isReady) return null;

  return (
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen name="Dashboard">{() => <DashboardScreen engine={engine} />}</Stack.Screen>
        <Stack.Screen name="Attendance">{() => <AttendanceScreen engine={engine} />}</Stack.Screen>
        <Stack.Screen name="Enrollment">{() => <EnrollmentScreen engine={engine} />}</Stack.Screen>
        <Stack.Screen name="ChainAudit">{() => <ChainAuditScreen engine={engine} />}</Stack.Screen>
        <Stack.Screen name="Sync">{() => <SyncScreen engine={engine} />}</Stack.Screen>
      </Stack.Navigator>
    </NavigationContainer>
  );
}
```

## Public API

For direct engine use:

```ts
import { GUARDEngine, GuardStorage, MemoryKeyValueStorage } from './src/GUARD';

const storage = new GuardStorage(
  new MemoryKeyValueStorage(),
  'NHAI-NH44-KM342',
  'android-device-001'
);

const guard = new GUARDEngine(
  {
    siteId: 'NHAI-NH44-KM342',
    deviceId: 'android-device-001',
    datalakeAuthToken: 'device-token',
    requireSupervisorLivenessForEnrollment: true,
    allowLowConfidenceCommit: true
  },
  storage
);

await guard.initialize();

const stats = guard.getStats();
```

## Model Assets

Model files are present in both root model storage and Android assets:

```text
models/blazeface.tflite
models/mobilefacenet.tflite
models/minifas.tflite
android/app/src/main/assets/models/blazeface.tflite
android/app/src/main/assets/models/mobilefacenet.tflite
android/app/src/main/assets/models/minifas.tflite
```

Android is configured with `noCompress += ["tflite"]` so TFLite assets can be loaded reliably from the APK.

Current model sources:

- BlazeFace and MobileFaceNet: `hugocornellier/face_detection_tflite`
- MiniFAS anti-spoofing model: `shubham0204/OnDevice-Face-Recognition-Android`

The current demo still uses deterministic TypeScript adapters and mock frames. The next production step is wiring these binaries into `FaceEngine` and `LivenessDetector` through `react-native-fast-tflite`.

## Configuration Notes

`App.tsx` uses demo defaults:

```ts
{
  siteId: 'NHAI-DEMO-SITE',
  deviceId: await DeviceInfo.getUniqueId(),
  datalakeAuthToken: 'demo-device-token',
  requireSupervisorLivenessForEnrollment: false,
  allowLowConfidenceCommit: true
}
```

For Datalake integration, replace these values with the authenticated user's active site, device identity, and auth token.

## Documentation

- `PRD.md` contains the full product requirements.
- `docs/INTEGRATION_GUIDE.md` contains integration-focused notes.
- `docs/BENCHMARKS.md` contains benchmark estimates and the validation checklist.
- `models/README.md` lists expected model assets.

## Submission Notes

The current implementation demonstrates the GUARD workflow and integrity architecture:

- Enroll worker
- Mark attendance
- Run liveness checks
- Commit chain records
- Verify chain integrity
- Sync pending records after ACK
- Show reconnect-triggered sync status

The remaining work is native production hardening, not a redesign of the module surface. The `GUARDEngine` facade, screen props, and data contracts are intentionally stable so Datalake can integrate the module without depending on internal ML or cryptographic implementation details.
