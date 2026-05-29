# GUARD Integration Guide

GUARD is designed as a small integration surface inside Datalake 3.0.

## 1. Add Models

Place model binaries in the native app bundle:

```text
android/app/src/main/assets/models/blazeface.tflite
android/app/src/main/assets/models/mobilefacenet.tflite
android/app/src/main/assets/models/minifas.tflite
```

The repository keeps only placeholders under `models/`; real `.tflite` files are ignored by Git.

## 2. Initialize Engine

```ts
import { GUARDEngine, GuardStorage, MemoryKeyValueStorage } from './src/GUARD';

const storage = new GuardStorage(
  new MemoryKeyValueStorage(),
  user.activeSiteId,
  deviceId
);

const guard = new GUARDEngine(
  {
    siteId: user.activeSiteId,
    deviceId,
    datalakeAuthToken: auth.token,
    syncEndpoint: 'https://datalake.example.gov.in/v1/attendance/sync',
    requireSupervisorLivenessForEnrollment: true
  },
  storage
);

await guard.initialize();
```

## 3. Mount Screens

```tsx
<Stack.Screen name="Attendance" component={guard.AttendanceScreen} />
<Stack.Screen name="Enrollment" component={guard.EnrollmentScreen} />
<Stack.Screen name="ChainAudit" component={guard.ChainAuditScreen} />
<Stack.Screen name="Sync" component={guard.SyncScreen} />
<Stack.Screen name="Dashboard" component={guard.DashboardScreen} />
```

## Current State

This scaffold uses deterministic TypeScript placeholders for camera frames, model inference, secure storage, and HMAC/SHA256. Replace those adapters with native implementations before production use.
