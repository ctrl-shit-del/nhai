# GUARD
### Geo-locked Unified Attendance & Recognition for Datalake

**Hackathon 7.0 Submission** — Offline facial recognition and liveness detection for NHAI field personnel authentication

---

## What GUARD Does

GUARD is a React Native application that solves attendance fraud at NHAI and EPC construction sites. Sites operate in zero-network zones where 200–500 laborers must be authenticated daily, but existing solutions require internet connectivity, produce deletable logs, or are easily proxied.

GUARD runs entirely offline on standard mid-range Android phones (3 GB RAM, Android 8+). It enrolls workers using their face, marks attendance with dual-layer liveness detection, writes every record to a tamper-evident SHA256 Merkle chain, and syncs cryptographically-signed batches to AWS only after receiving a server acknowledgment.

---

## Architecture

```
Front camera (VisionCamera snapshot/photo)
        ↓
JPEG decode → EXIF upright → square center crop → 640px downscale
        ↓
BlazeFace TFLite (face detection, MediaPipe anchor decode)
        ↓
Active liveness: blink / smile / head-turn challenges
Passive liveness: MiniFAS TFLite (softmax logits → spoof score)
        ↓ (both pass)
MobileFaceNet TFLite → 128-dim L2-normalized embedding
        ↓
MMKV-encrypted embedding store + cosine match
        ↓ (matched)
SHA256 Merkle Chain record (timestamp + GPS + embeddingHash + prevHash)
        ↓
Signed sync batch → AWS Datalake 3.0 (purge only after server ACK)
```

---

## Key Differentiators

### 1. SHA256 Merkle Chain Audit Log
Every attendance record is chained: `Record_N = SHA256(data ∥ Record_{N-1}.hash)`. Any deletion, insertion, or modification of any record breaks the chain and is detected on sync.

### 2. Dual-Layer Liveness Detection
**Active:** Randomized challenges (blink, smile, head turn) per session.

**Passive:** MiniFAS TFLite with softmax over `[spoof, unknown, real]` logits plus heuristic fallback.

### 3. Offline-First Face Pipeline
Real TFLite inference on-device (BlazeFace + MobileFaceNet + MiniFAS). Camera capture uses JPEG snapshot/photo decode (works on Android GPUs where raw frame buffers fail). EXIF orientation + square crop keeps enrollment and attendance geometry consistent across screens.

### 4. Signed Commit Protocol
Sync batches are HMAC-SHA256 signed. Local records are purged **only after** a signed server ACK.

### 5. Hardware-Backed Key Storage
Embedding encryption keys use Android Keystore / iOS Keychain when available; development fallback is logged loudly.

---

## Model Footprint

| Model | Size | Purpose | Input | Output |
|---|---|---|---|---|
| BlazeFace | 224 KB | Face detection | 128×128 RGB | 896-anchor regressors + scores |
| MobileFaceNet | 5.0 MB | Face embedding | 112×112 RGB | 128-dim vector |
| MiniFAS | 5.8 MB | Anti-spoof | 80×80 RGB | 3-class logits |
| **Total** | **~11 MB** | | | **Under 20 MB cap** |

Models live at:
```
android/app/src/main/assets/models/blazeface.tflite
android/app/src/main/assets/models/mobilefacenet.tflite
android/app/src/main/assets/models/minifas.tflite
```
Copy from `models/` per `models/README.md` before building.

---

## Project Structure

```
index.js                         Entry — Reanimated + worklets-core
App.tsx                          Navigation, engine init, auto-sync
android/                         Native Android (com.guard.datalake)
src/
  config/GUARDEngine.ts          Main facade — enroll, attendance, sync
  screens/                       Dashboard, Enrollment, Attendance, Audit, Sync
  hooks/useCameraFrame.ts        JPEG capture pipeline (snapshot-first)
  ml/FaceEngine.ts               BlazeFace + MobileFaceNet
  ml/blazefaceDecode.ts          MediaPipe 896-anchor decoder
  ml/LivenessDetector.ts         Active + passive liveness
  security/MerkleChain.ts        Tamper-evident chain
  security/EmbeddingStore.ts     MMKV encrypted embeddings
  utils/frameConversion.ts       JPEG → RGB
  utils/frameUtils.ts            EXIF, square crop, downscale
  utils/jpegExif.ts              EXIF orientation reader
  utils/locationService.ts       GPS permission + attendance fix
docs/
  PRD.md                         Product requirements
  INTEGRATION_GUIDE.md           Datalake 3.0 mount guide
  VIDEO_SCRIPT.md                Demo video shot list + narration
```

---

## Prerequisites

- **Node.js** 18+
- **Java 17** — set `JAVA_HOME` to JDK 17
- **Android Studio** with SDK 34, build-tools, NDK (installed via SDK Manager)
- **ANDROID_HOME** set (e.g. `C:\Users\<you>\AppData\Local\Android\Sdk`)
- Physical Android device (USB debugging) recommended for camera/ML demo

---

## Development Setup

```powershell
npm install

# Terminal 1 — Metro bundler (only needed for debug/dev builds)
npx react-native start

# Terminal 2 — install debug build on connected device
npx react-native run-android
```

Grant **Camera** and **Location** when prompted.

---

## Build a Standalone APK (No Metro Required)

A **release APK** bundles JavaScript inside the app. You do **not** need `npx react-native start` or `run-android` to run it — install the APK and open GUARD like any other app.

### One-time: ensure models are in assets

```powershell
# From repo root — copy TFLite files if not already present
mkdir android\app\src\main\assets\models -Force
copy models\*.tflite android\app\src\main\assets\models\
```

### Build release APK (Windows)

```powershell
cd android
.\gradlew.bat assembleRelease
```

**Output file:**
```
android\app\build\outputs\apk\release\app-release.apk
```

### Install on a phone

**Option A — USB:**
```powershell
adb install -r android\app\build\outputs\apk\release\app-release.apk
```

**Option B — Share the APK** (WhatsApp, Drive, etc.) and enable “Install unknown apps” on the device.

> Release builds currently sign with the debug keystore (fine for hackathon demos). For Play Store or production, generate a release keystore — see [React Native signed APK docs](https://reactnative.dev/docs/signed-apk-android).

### Debug vs release

| Build | Metro needed? | Command |
|---|---|---|
| Debug (dev) | Yes — `npx react-native start` | `npx react-native run-android` |
| Release APK | **No** | `cd android; .\gradlew.bat assembleRelease` |

---

## Demo Walkthrough

**Recommended:** Airplane mode ON to prove offline operation.

### 0 — Fresh start (if re-testing face matching)
1. Open **Dashboard** → **Clear enrolled workers** (removes stale embeddings from prior builds).

### 1 — Enroll a worker (~30 sec)
1. **Enrollment** → tap **Capture** on S1, S2, S3 (fast snapshot capture; green ✓ when quality OK).
2. Enter **Worker name** and optional **Labour contract ID** (used as stable worker ID).
3. **Save Enrollment** → log should show `Enroll self-check: sample1 vs template 90%+`.

### 2 — Mark attendance (~30 sec)
1. **Attendance** → **Mark Attendance** → complete liveness prompt → **Complete Challenge**.
2. Success: `Matched <name> at 90%+ (HIGH)` and chain record committed.
3. GPS: works outdoors; indoors attendance proceeds without coordinates if GPS unavailable.

### 3 — Chain audit (~10 sec)
1. **Chain Audit** → **Verify Integrity** → `Valid`.

### 4 — Sync (~15 sec)
1. Disable airplane mode → **Sync** → **Start Manual Sync**.
2. Mock ACK in demo mode until `syncEndpoint` is configured in `App.tsx`.

---

## Configuration

Key options in `App.tsx` (`GUARDConfig`):

| Field | Demo value | Notes |
|---|---|---|
| `allowLowConfidenceCommit` | `true` | Recognition threshold 55% for demo |
| `syncEndpoint` | unset | Mock ACK; set for production |
| `siteLocation` | unset | Geofence disabled for indoor demo |

---

## Integration Into Datalake 3.0

**Step 1** — Add model files to Android assets (see above).

**Step 2** — Initialize the engine:
```tsx
import { GUARDEngine } from './guard/src/GUARD';

const guard = new GUARDEngine({
  siteId:    activeSite.id,
  deviceId:  await DeviceInfo.getUniqueId(),
  datalakeAuthToken: auth.token,
  syncEndpoint: 'https://api.datalake3.nhai.gov.in/v1/attendance/sync',
  allowLowConfidenceCommit: true,
});
await guard.initialize();
```

**Step 3** — Mount screens in your navigator (see `docs/INTEGRATION_GUIDE.md`).

---

## Windows Build Troubleshooting

If Gradle fails on TFLite AAR file locks:

```cmd
cd android
gradlew.bat --stop
rmdir /s /q "%USERPROFILE%\.gradle\caches\modules-2\files-2.1\com.google.ai.edge.litert"
gradlew.bat clean
gradlew.bat assembleRelease
```

If `JAVA_HOME` errors appear, point it to JDK 17:
```powershell
$env:JAVA_HOME = "C:\Program Files\Java\jdk-17"
```

---

## What's Working (Demo Build)

| Component | Status |
|---|---|
| TFLite BlazeFace + MobileFaceNet + MiniFAS | ✅ On-device inference |
| Enrollment 3-sample capture | ✅ Snapshot pipeline, ~640×640 |
| Face match attendance | ✅ 90%+ same-session match |
| MiniFAS passive liveness | ✅ Softmax over 3-class logits |
| MMKV embedding persistence | ✅ Survives restart |
| Merkle chain + sync protocol | ✅ Mock ACK in demo |
| GPS | ✅ On-demand fix; optional indoors |
| Keychain | ⚙️ Fallback key in dev emulators |

---

## Documentation

| Doc | Purpose |
|---|---|
| [docs/PRD.md](docs/PRD.md) | Full product requirements |
| [docs/INTEGRATION_GUIDE.md](docs/INTEGRATION_GUIDE.md) | Datalake 3.0 integration |
| [docs/BENCHMARKS.md](docs/BENCHMARKS.md) | Performance targets |
| [docs/VIDEO_SCRIPT.md](docs/VIDEO_SCRIPT.md) | Hackathon demo video script |

---

## GitHub

```
https://github.com/ctrl-shit-del/nhai.git
```
