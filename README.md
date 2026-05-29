# GUARD

Geo-locked Unified Attendance & Recognition for Datalake.

GUARD is an offline-first React Native module for NHAI and EPC construction-site attendance. It is designed for low-connectivity field conditions where supervisors must enroll workers, mark attendance, keep tamper-evident local records, and sync verified records only after connectivity returns.

The module combines:

- Local worker enrollment and recognition flow
- Active and passive liveness checks
- GPS-backed attendance records
- Site/device-specific SHA256 Merkle chain audit log
- MMKV-backed embedding persistence
- Signed, chunked sync batches with ACK-gated purge behavior
- A React Navigation demo app shell with five screens

## Repository Status

This repository is a TypeScript/React Native implementation scaffold plus a runnable demo entry point. It is ready for code review, typechecking after dependency installation, and integration into an existing React Native host app such as Datalake 3.0.

It is not yet a full production biometric system. Native camera frame processors, real TFLite model inference, hardware-backed encryption, AWS server verification, and measured field benchmarks remain future integration work.

## What Is Implemented

| Area | Status |
|---|---|
| App shell | `App.tsx` initializes GUARD, mounts all five screens in a native-stack navigator, and shows reconnect sync status. |
| Engine facade | `GUARDEngine` exposes enrollment, attendance, stats, sync, chain audit, and screen components behind one API. |
| Screens | Dashboard, Attendance, Enrollment, Chain Audit, and Sync screens accept an engine prop and call engine methods. |
| Device ID | `DeviceInfo.ts` uses `react-native-device-info` so chain records use the actual device ID instead of `unknown-device`. |
| Network monitor | `useNetworkMonitor` uses `NetInfo.addEventListener()` and unsubscribes correctly. |
| Hashing | Chain and sync hashing use real SHA256/HMAC-SHA256 through `crypto-js`. |
| Enrollment | Captures three mock samples, builds `WorkerProfile`, calls `engine.enrollWorker()`, and persists transformed embeddings. |
| Liveness | Active randomized challenge sessions exist. Passive liveness uses a multi-signal heuristic until MiniFAS is integrated. |
| Recognition | Current `FaceEngine` is deterministic and local, with CLAHE preprocessing, normalized embeddings, cosine matching, and confidence tiers. |
| Merkle chain | Attendance and spoof incident records are chained, locally verifiable, and site/device-specific. |
| Sync | Creates 50-record signed batches, validates mock ACKs, marks records synced, and purges only after ACK timing rules. |
| Benchmarks doc | `docs/BENCHMARKS.md` contains planning estimates and the validation checklist for physical-device runs. |

## What Is Still Pending

| Area | Remaining work |
|---|---|
| Camera | Replace mock `ImageFrame` objects with `react-native-vision-camera` frame processors. |
| ML models | Replace deterministic `FaceEngine` logic with BlazeFace, MobileFaceNet, MediaPipe landmarks, and MiniFAS TFLite inference. |
| Passive liveness | Replace heuristic scoring with MiniFAS model output. |
| Active liveness | Replace simulated challenge completion with EAR/MAR/head-pose landmark checks. |
| Security hardening | Bind embeddings and chain storage to hardware-backed keys and production encrypted storage. |
| Backend | Implement `/v1/attendance/sync`, server-side chain verification, Datalake DB commit, and signed server ACKs. |
| Resumable sync | Add pending batch IDs, interrupted upload resume, ACK-loss recovery, and active-sync conflict logging. |
| Field validation | Run measured benchmarks on physical devices with final `.tflite` assets. |

## Project Structure

```text
App.tsx                         Demo app entry and navigation shell
src/GUARD.ts                    Public exports
src/config/GUARDEngine.ts       Main facade used by host apps
src/screens/                    Five React Native screens
src/hooks/                      Engine and network hooks
src/ml/                         Preprocessing, face engine, liveness detector
src/security/                   Embedding store and Merkle chain
src/storage/                    Chain persistence adapter
src/sync/                       Batch creation, ACK validation, purge flow
src/types/                      Public data contracts
src/utils/                      Device, GPS, hash helpers
docs/                           Integration guide and benchmark notes
models/                         Expected model asset names
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
- A React Native host app with native `android/` and/or `ios/` folders

This repository contains the TypeScript module and `App.tsx` demo entry. It does not include committed native Android/iOS project folders. For a device demo, mount it inside the existing Datalake 3.0 React Native app or another RN host shell.

## Install Dependencies

From the repository root:

```sh
npm install
```

The dependency list includes the runtime packages used by the demo app:

- `@react-navigation/native`
- `@react-navigation/native-stack`
- `react-native-screens`
- `react-native-safe-area-context`
- `@react-native-community/netinfo`
- `@react-native-community/geolocation`
- `react-native-device-info`
- `react-native-mmkv`
- `crypto-js`

For iOS, install pods from the host React Native app:

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

Equivalent direct command:

```sh
npx tsc --noEmit
```

Run linting if the host environment has ESLint configured:

```sh
npm run lint
```

Note: Typechecking requires `node_modules` to be installed first. Running `npx tsc --noEmit` without installed dependencies may fetch the wrong `tsc` package from npm.

## Run the Demo App

### Option A: Run inside the Datalake 3.0 React Native app

1. Copy or include this repository's `src/`, `App.tsx`, `docs/`, `models/`, `package.json` dependency entries, and `tsconfig.json` paths into the Datalake 3.0 React Native workspace.
2. Install dependencies in the host app:

   ```sh
   npm install
   ```

3. For iOS, install pods:

   ```sh
   cd ios
   pod install
   cd ..
   ```

4. Point the host app entry to `App.tsx`, or mount the GUARD navigator from the host app's existing navigation tree.
5. Start Metro:

   ```sh
   npx react-native start
   ```

6. Run Android:

   ```sh
   npx react-native run-android
   ```

7. Run iOS:

   ```sh
   npx react-native run-ios
   ```

### Option B: Mount GUARD screens in an existing navigation stack

If the host app already initializes authentication, site selection, and navigation, use the facade directly:

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

Expected production model files are documented in `models/README.md`:

```text
models/blazeface.tflite
models/mobilefacenet.tflite
models/minifas.tflite
```

The current demo does not require these files because it uses deterministic TypeScript adapters and mock frames. Add the real `.tflite` files through the native app asset pipeline before production benchmarking.

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
- `docs/INTEGRATION_GUIDE.md` contains the integration-focused notes.
- `docs/BENCHMARKS.md` contains benchmark estimates and the validation checklist.
- `models/README.md` lists expected model assets.

## Professional Submission Notes

The current implementation demonstrates the complete GUARD workflow and the integrity architecture:

- Enroll worker
- Mark attendance
- Run liveness checks
- Commit chain records
- Verify chain integrity
- Sync pending records after ACK
- Show reconnect-triggered sync status

The remaining work is native production hardening, not a redesign of the module surface. The `GUARDEngine` facade, screen props, and data contracts are intentionally stable so Datalake can integrate the module without depending on internal ML or cryptographic implementation details.
