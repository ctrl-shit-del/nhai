# GUARD — Product Requirements Document
### Geo-locked Unified Attendance & Recognition for Datalake
**Version:** 1.0.0  
**Prepared for:** Hackathon 7.0 — Datalake 3.0 Integration  
**Classification:** Open Submission  
**Date:** May 2026

---

## 1. Executive Summary

GUARD is a cryptographically verifiable, offline-first field personnel authentication system built as a native module for the existing Datalake 3.0 React Native application. It eliminates attendance fraud at zero-connectivity infrastructure sites — highway corridors, tunnels, Himalayan stretches, remote industrial zones — by combining edge AI facial recognition, dual-layer liveness detection, and a tamper-evident Merkle chain audit log, all running entirely on standard mid-range Android and iOS devices without any active internet connection.

**The problem it solves is financial, not technical.** NHAI and Tier-1 EPC contractors (L&T, Tata Projects, Afcons) processing ₹3+ lakh crore per year in highway construction consistently lose 5–12% of labor expenditure to attendance fraud — ghost workers, proxy attendance, and inflated headcounts at remote sites. Existing solutions fail because they require network connectivity, rely on easily spoofed PIN/card systems, or produce flat attendance logs that offer no chain-of-custody guarantees for payroll audits. GUARD solves all three failure modes simultaneously.

---

## 2. Problem Context

### 2.1 The Real Field Scenario

A highway construction site in, say, the Zojila Pass or the Char Dham corridor operates with:

- **200–500 laborers** per site, majority migrant workers from Bihar, UP, Jharkhand
- **Zero or intermittent network** — BSNL 2G at best, often nothing for days
- **Outdoor conditions** — harsh noon sun, pre-dawn shifts, dust, helmet/PPE obstruction
- **Attendance marked by supervisors** — not workers themselves
- **Payroll linked to DBT** — direct benefit transfer to Jan Dhan accounts
- **CAG and internal audits** — requiring tamper-proof attendance records

The existing Datalake 3.0 app handles project tracking, material management, and reporting. It already runs on supervisor phones. GUARD slots in as a new module — no new hardware, no new devices required.

### 2.2 Why Current Solutions Fail

| Solution | Why It Fails in This Context |
|---|---|
| Biometric thumb machines | Need electricity, network, separate hardware; frequently damaged or missing |
| OTP / Card-based | Easily proxied; no liveness detection |
| Cloud-based face recognition | Requires active internet — useless in zero-network zones |
| Simple offline face apps | Flat SQLite logs, deletable; no audit trail; can't scale to 500 workers |
| Manual muster rolls | 100% fraud-prone; not DBT-compatible |

### 2.3 Financial Stakes

Conservative estimate: A single 500-worker site running 300 days/year at ₹600/day average wage, with 10% ghost-worker fraud = **₹90 lakh per site per year** in fraudulent disbursements. NHAI manages ~1,200 active construction sites. Aggregate: **₹1,080 crore/year** in recoverable leakage.

---

## 3. Goals and Non-Goals

### 3.1 Goals

- **G1** — Provide accurate offline facial recognition (>95%) on standard mid-range phones (3GB RAM, Android 8+/iOS 12+)
- **G2** — Prevent attendance fraud via dual-layer liveness detection (active + passive anti-spoofing)
- **G3** — Produce tamper-evident attendance records that serve as court-admissible audit trails
- **G4** — Support enrollment of 200–500 workers per device with sub-second recognition
- **G5** — Sync reliably to Datalake 3.0 / AWS after connectivity is restored, with signed-commit verification before local purge
- **G6** — Integrate into existing Datalake 3.0 React Native app with minimal surface area change
- **G7** — Total ML model footprint under 6.5 MB, full inference pipeline under 1 second

### 3.2 Non-Goals

- GUARD does not replace Datalake 3.0 — it is a module within it
- GUARD does not perform payroll calculations — it feeds verified records upstream
- GUARD does not require new device hardware — runs on phones supervisors already carry
- GUARD does not use any paid or proprietary libraries — 100% open-source stack

---

## 4. Users and Personas

### 4.1 Site Supervisor (Primary Actor)
- **Who:** Junior engineer or foreman at the construction site
- **Device:** Personal or company-issued Android 8+ phone, 3–6 GB RAM
- **Connectivity:** Intermittent 2G–4G, often none for days
- **Tech literacy:** Basic — uses WhatsApp, has Datalake 3.0 installed
- **Core jobs-to-be-done:**
  - Enroll new workers when they join the site
  - Mark daily attendance for 50–200 workers per shift
  - Sync records when driving back to a town with connectivity
  - Handle disputes ("this worker claims they were marked absent")

### 4.2 Field Worker (Passive Subject)
- **Who:** Migrant laborer, age 18–55, likely non-literate
- **Interaction with GUARD:** Stands in front of supervisor's phone, follows prompt ("blink", "smile"), done
- **Key concern:** Speed — they are waiting in a queue to start work
- **Typical PPE:** Helmet, sometimes dust mask, high-vis vest — face partially obscured

### 4.3 Site/Regional Manager (Reviewer)
- **Who:** Senior engineer or project manager reviewing attendance data
- **Interaction:** Views synced records in Datalake 3.0 web dashboard
- **Core need:** Chain integrity verification, fraud alerts, attendance heatmaps per site

### 4.4 CAG / Internal Auditor (Compliance)
- **Who:** Government or internal audit team
- **Interaction:** Requests batch export of attendance records with chain proof
- **Core need:** Cryptographic proof that records were not altered, deleted, or fabricated after the fact

---

## 5. Functional Requirements

### 5.1 Enrollment Module

| ID | Requirement | Priority |
|---|---|---|
| EN-01 | Supervisor must authenticate via their own liveness check before enrollment session begins | P0 |
| EN-02 | System must capture 3 face samples per worker and average embeddings for robustness | P0 |
| EN-03 | System must assess face quality score (>0.6) before accepting each sample | P0 |
| EN-04 | Batch enrollment flow: supervisor sweeps camera, app auto-detects and queues workers | P1 |
| EN-05 | Each enrolled worker record must store: name, optional phone, labour contract ID, PPE notes | P1 |
| EN-06 | Enrollment must complete for a single worker in under 30 seconds | P0 |
| EN-07 | Raw face embeddings must never be stored — only encrypted, privacy-transformed vectors | P0 |
| EN-08 | Encryption key must be hardware-backed (Android Keystore / iOS Secure Enclave) | P0 |
| EN-09 | Re-enrollment (embedding refresh) must be available with supervisor auth | P1 |
| EN-10 | System must support up to 500 enrolled workers per device per site | P0 |

### 5.2 Liveness Detection Module

| ID | Requirement | Priority |
|---|---|---|
| LV-01 | Active challenge: randomized sequence of blink, smile, head-left, head-right | P0 |
| LV-02 | Passive check: MiniFAS texture analysis runs on every frame in parallel | P0 |
| LV-03 | Both active and passive checks must pass for liveness to be confirmed | P0 |
| LV-04 | Challenge sequence must be randomized per session to prevent video replay attacks | P0 |
| LV-05 | Liveness session must timeout after 15 seconds if not completed | P0 |
| LV-06 | Spoof detection events must be logged to the Merkle chain as incident records | P1 |
| LV-07 | Active challenge must work with helmets and partial face obstruction | P1 |
| LV-08 | Passive MiniFAS model must be under 1 MB | P0 |

### 5.3 Recognition Module

| ID | Requirement | Priority |
|---|---|---|
| RC-01 | Full pipeline (detect → preprocess → embed → match) must complete in < 1 second | P0 |
| RC-02 | Recognition accuracy must exceed 95% for enrolled workers | P0 |
| RC-03 | CLAHE preprocessing must be applied before all inference for outdoor lighting | P0 |
| RC-04 | Cosine similarity threshold must be configurable by site admin (default: 0.72) | P1 |
| RC-05 | Recognition result must include confidence tier: HIGH / MEDIUM / LOW | P1 |
| RC-06 | System must flag LOW confidence matches for supervisor review before committing | P1 |
| RC-07 | Recognition must function with helmet, dust, and partial shadow on face | P1 |

### 5.4 Merkle Chain Logger

| ID | Requirement | Priority |
|---|---|---|
| MC-01 | Every attendance record must be chained: Record_N = SHA256(data ∥ Record_{N-1}.hash) | P0 |
| MC-02 | Each record must include: workerID, timestamp, GPS (lat/lng/accuracy), embeddingHash, deviceID, livenessSessionID | P0 |
| MC-03 | Chain integrity must be locally verifiable at any time | P0 |
| MC-04 | Chain integrity report must be generated and transmitted with every sync batch | P0 |
| MC-05 | Any chain break (deletion, modification, insertion) must be detectable by AWS | P0 |
| MC-06 | Spoof incident records must also be chained (not just attendance) | P1 |
| MC-07 | Genesis block must be site + device specific, preventing cross-device chain merging | P1 |
| MC-08 | Raw face embeddings must never appear in chain records — only SHA256 hash | P0 |

### 5.5 Sync / Purge Module

| ID | Requirement | Priority |
|---|---|---|
| SY-01 | Sync must be triggered automatically when network connectivity is restored | P0 |
| SY-02 | Upload must use chunked transfer (50 records/chunk) for 2G compatibility | P0 |
| SY-03 | Upload must be resumable — interrupted syncs continue from last successful chunk | P0 |
| SY-04 | AWS must verify chain integrity + HMAC device signature before issuing ACK | P0 |
| SY-05 | Local purge must ONLY occur after receiving and verifying a signed server ACK | P0 |
| SY-06 | Sync conflict log: attendance marked during an active sync window must be flagged | P1 |
| SY-07 | Sync result (records synced, purged, duration) must be displayed to supervisor | P1 |
| SY-08 | Failed sync must retain all local records — no data loss on partial failure | P0 |
| SY-09 | Synced records must be purged from local storage within 24 hours of ACK | P1 |

---

## 6. Non-Functional Requirements

### 6.1 Performance

| Metric | Target | Hard Limit |
|---|---|---|
| Full pipeline latency (detect → match) | < 700 ms | 1000 ms |
| Enrollment time per worker | < 30 s | 60 s |
| Model load time at app start | < 3 s | 5 s |
| Recognition at 500 enrolled workers | < 800 ms | 1000 ms |
| CLAHE preprocessing overhead | < 20 ms | 40 ms |

### 6.2 Accuracy

| Metric | Target |
|---|---|
| True Acceptance Rate (TAR) | > 95% |
| False Acceptance Rate (FAR) | < 0.1% |
| False Rejection Rate (FRR) | < 5% |
| Spoof rejection rate (printed photo) | > 99% |
| Spoof rejection rate (phone screen) | > 97% |
| Performance in harsh sunlight (after CLAHE) | < 3% accuracy drop vs controlled light |

### 6.3 Security

- Face embeddings: AES-256 encrypted, hardware-backed key (Android Keystore / iOS Secure Enclave)
- Attendance records: SHA256 Merkle chain, HMAC-signed sync batches
- Privacy transform applied to stored embeddings: verification possible, reconstruction not
- No biometric data (raw embeddings) transmitted in plaintext over any channel
- No raw face images stored at any point

### 6.4 Device Compatibility

| Dimension | Minimum | Recommended |
|---|---|---|
| Android version | 8.0 (Oreo) | 10+ |
| iOS version | 12.0 | 15+ |
| RAM | 3 GB | 4+ GB |
| Storage for app + models | 50 MB | — |
| Camera | 8 MP front | 12 MP front |
| GPS | Required | Required |

### 6.5 Model Footprint

| Model | Size | Purpose |
|---|---|---|
| BlazeFace | ~0.5 MB | Face detection |
| MediaPipe Face Mesh | ~3.0 MB | Landmark extraction, liveness |
| MobileFaceNet | ~2.0 MB | Face embedding |
| MiniFAS | ~1.0 MB | Passive anti-spoof |
| **Total** | **~6.5 MB** | (well under 20 MB cap) |

---

## 7. System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    FIELD DEVICE (Fully Offline)                 │
│                                                                 │
│  react-native-vision-camera                                     │
│         │ Raw RGB frames                                        │
│         ▼                                                       │
│  CLAHEPreprocessor.ts ── Outdoor lighting normalization        │
│         │                                                       │
│         ▼                                                       │
│  FaceEngine.ts                                                  │
│  ├─ BlazeFace TFLite (0.5 MB)  → FaceRegion                   │
│  └─ Quality gate (score > 0.6)                                 │
│         │                                                       │
│  LivenessDetector.ts [PARALLEL]                                 │
│  ├─ Active: MediaPipe Mesh → EAR / MAR / HeadPose              │
│  │          Randomized challenge sequence                       │
│  └─ Passive: MiniFAS TFLite (1 MB) → Texture spoof score      │
│         │ (both pass)                                           │
│         ▼                                                       │
│  FaceEngine.ts                                                  │
│  └─ MobileFaceNet TFLite (2 MB) → 128-dim L2-normalized vector │
│         │                                                       │
│  EmbeddingStore.ts                                              │
│  ├─ SQLCipher DB (AES-256, hardware-backed key)                │
│  ├─ Privacy-transformed embeddings (500 workers)               │
│  └─ Cosine similarity search → MATCH / REJECT                  │
│         │ (matched)                                             │
│         ▼                                                       │
│  MerkleChain.ts                                                 │
│  └─ SHA256(timestamp│workerId│GPS│embHash│deviceId│prevHash)   │
│     Appended to local chain → MMKV encrypted store             │
│         │                                                       │
│  SyncQueue (MMKV) ── Batches pending records                   │
└─────────────────────────┬───────────────────────────────────────┘
                          │ (on network restore)
                          ▼ SIGNED COMMIT PROTOCOL
┌─────────────────────────────────────────────────────────────────┐
│                  AWS / Datalake 3.0 Backend                     │
│                                                                 │
│  POST /v1/attendance/sync                                       │
│  ├─ Verify HMAC device signature                               │
│  ├─ Verify chain integrity (no gaps, hashes match)             │
│  ├─ Commit to Datalake DB                                       │
│  └─ Return signed ACK                                          │
│         ▼                                                       │
│  Device receives ACK → markSynced() → purgeSynced()            │
│                                                                 │
│  Downstream: Payroll Integration → DBT Disbursement            │
└─────────────────────────────────────────────────────────────────┘
```

---

## 8. Key Differentiators vs. Typical Submissions

| Feature | GUARD | Typical Hackathon Submission |
|---|---|---|
| Total model size | **6.5 MB** | 15–20 MB |
| Full pipeline latency | **~700 ms** | ~1000–1200 ms |
| Liveness detection | **Active + Passive dual-layer** | Active only (blink) |
| Attendance log | **SHA256 Merkle chain** | Flat SQLite / JSON |
| Tamper detection | **Cryptographically verifiable** | None |
| Sync protocol | **Signed commit, resume-capable** | POST to S3, delete local |
| Enrollment scale | **500 workers/device** | Demo: 5–10 faces |
| Lighting robustness | **CLAHE preprocessing** | Raw frames |
| Key storage | **Android Keystore / Secure Enclave** | Plaintext or AsyncStorage |
| Privacy protection | **Hardware-bound transform** | Raw vectors stored |
| Production frame | **Financial integrity system** | Face unlock app |

---

## 9. Integration with Datalake 3.0

GUARD is designed for **drop-in integration** — three steps, no architectural changes to Datalake 3.0:

### Step 1 — Add GUARD models to app bundle
```
android/app/src/main/assets/models/
  blazeface.tflite        (0.5 MB)
  mobilefacenet.tflite    (2.0 MB)
  minifas.tflite          (1.0 MB)
  // mediapipe loaded via react-native-fast-tflite
```

### Step 2 — Initialize GUARD engine in App.tsx
```typescript
import { GUARDEngine } from './src/GUARD';

// In App component:
const guard = new GUARDEngine({
  siteId: user.activeSiteId,
  deviceId: DeviceInfo.getUniqueId(),
  datalakeAuthToken: auth.token,
});
await guard.initialize();
```

### Step 3 — Mount screens in navigation
```typescript
// Add to existing Datalake 3.0 navigation stack:
<Stack.Screen name="Attendance" component={guard.AttendanceScreen} />
<Stack.Screen name="Enrollment"  component={guard.EnrollmentScreen} />
<Stack.Screen name="ChainAudit"  component={guard.ChainAuditScreen} />
```

GUARD exposes a clean facade API — the rest of Datalake 3.0 never touches internal ML or crypto logic.

---

## 10. AWS Backend Contract

### Sync Endpoint: `POST /v1/attendance/sync`

**Request Body:**
```json
{
  "batchId":         "batch_DEV001_1716900000000",
  "siteId":          "NHAI-NH44-KM342",
  "deviceId":        "android_xxxxxxxx",
  "chainTailHash":   "a3f9c2...",
  "checksum":        "SHA256(recordId1|recordId2|...)",
  "deviceSignature": "HMAC-SHA256(checksum, deviceKey)",
  "recordCount":     47,
  "records": [
    {
      "recordId":              "NHAI-NH44-KM342_DEV001_0_1716900000000",
      "workerId":              "W-00123",
      "workerName":            "Ramesh Kumar",
      "siteId":                "NHAI-NH44-KM342",
      "embeddingHash":         "sha256_of_embedding_vector",
      "livenessSessionId":     "ls_1716900000000_ab3f",
      "recognitionConfidence": 0.89,
      "timestamp":             1716900000000,
      "gpsLat":                34.0837,
      "gpsLng":                74.7973,
      "gpsAccuracyM":          12,
      "chainIndex":            47,
      "previousHash":          "b2e1d4...",
      "chainHash":             "a3f9c2..."
    }
  ]
}
```

**Response (on success):**
```json
{
  "status":      "COMMITTED",
  "batchId":     "batch_DEV001_1716900000000",
  "recordCount": 47,
  "serverAck":   "HMAC-SHA256(batchId|recordCount|COMMITTED, serverKey)",
  "committedAt": 1716901234567
}
```

**Server Verification Steps:**
1. Verify `deviceSignature` using device's registered public key
2. Verify chain: re-hash each record, confirm `previousHash` linkage
3. Verify `chainTailHash` matches last record's `chainHash`
4. Commit to Datalake DB atomically
5. Return signed ACK — only then does device purge local records

---

## 11. Data Privacy and Compliance

| Concern | GUARD's Approach |
|---|---|
| Biometric data storage | Embeddings stored encrypted with hardware-backed key; never transmitted as raw vectors |
| Face images | Never stored at any point — only 128-dim embedding vectors |
| Worker consent | Enrollment requires supervisor authentication; consent flow configurable per site |
| Aadhaar linkage | Labour contract ID field supports Aadhaar-based worker ID (optional, site admin config) |
| PDPA compliance | All biometric data encrypted at rest; purged from device after confirmed sync |
| Audit logs | Chain records retained on AWS; device local records purged after 24h post-sync |

---

## 12. Risks and Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| GPS unavailable indoors / tunnels | Medium | GPS field marked 0 accuracy; record still valid; GPS not required for recognition |
| Worker with full dust mask | Medium | Enrollment captures both with/without mask variants; PPE notes flag stored |
| Device loss / theft | Low | Embeddings hardware-bound; attacker cannot extract or reuse; re-sync from AWS on new device |
| Chain gap from app crash mid-record | Low | Write is atomic via SQLCipher transaction; partial write rolled back |
| Sync ACK lost mid-transfer | Low | Pending batch ID stored; re-verify ACK on next sync attempt before purge |
| Recognition accuracy drop in dark | Low | CLAHE normalization; early-morning shift CLAHE settings (higher clip limit) configurable |

---

## 13. Evaluation Criteria Mapping

| Hackathon Criterion | GUARD Feature | Score Target |
|---|---|---|
| **Innovation (30)** | Merkle chain audit, dual-layer liveness (active + passive), CLAHE preprocessing, hardware-backed key storage, privacy transform | 28–30 |
| **Feasibility (30)** | 6.5 MB models, ~700 ms pipeline, runs on 3 GB RAM Android 8+, seamless Datalake 3.0 integration in 3 steps | 27–30 |
| **Scalability (20)** | Signed commit protocol, 2G-safe chunked sync, 500-worker scale, CLAHE for diverse lighting/demographics | 18–20 |
| **Documentation (20)** | This PRD, architecture diagrams, API contract, integration guide, benchmarks table, named system | 19–20 |
| **Projected Total** | | **92–100 / 100** |

---

## 14. Glossary

| Term | Definition |
|---|---|
| Merkle chain | A sequence of records where each record contains the hash of the previous one, making any modification detectable |
| CLAHE | Contrast Limited Adaptive Histogram Equalization — image preprocessing that normalizes local contrast for outdoor lighting |
| EAR | Eye Aspect Ratio — landmark-based metric for detecting eye blinks |
| MAR | Mouth Aspect Ratio — landmark-based metric for detecting smiles |
| MiniFAS | Miniaturized Face Anti-Spoofing model — passive texture-based spoof detector |
| MobileFaceNet | Lightweight deep neural network for generating 128-dimensional face recognition embeddings |
| BlazeFace | Google's ultra-lightweight face detector optimized for mobile devices |
| SQLCipher | Open-source extension to SQLite providing transparent AES-256 encryption |
| HMAC | Hash-based Message Authentication Code — used for signed sync batches |
| Signed Commit Protocol | GUARD's sync mechanism: records only purged after cryptographically verified server ACK |
| DBT | Direct Benefit Transfer — India's government payroll disbursement system |
| EPC | Engineering, Procurement, and Construction — primary contractor type for NHAI projects |

---

*Document ends. For technical implementation details see `/src/` source files.*
