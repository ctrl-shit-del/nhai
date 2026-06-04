# GUARD — Hackathon Demo Video Script

**Target length:** 3–5 minutes  
**Format:** Screen recording (Android) + optional face-cam B-roll + voiceover  
**Goal:** Show offline face enrollment, liveness-gated attendance, tamper-evident chain, and sync — in one continuous story.

---

## Pre-Production Checklist

- [ ] Build **release APK** (`.\gradlew.bat assembleRelease`) and install on a physical phone — no laptop/Metro visible in demo.
- [ ] Good lighting on your face (window or desk lamp; avoid strong backlight).
- [ ] **Clear enrolled workers** on Dashboard before recording enrollment segment.
- [ ] Enable **Do Not Disturb** on the phone.
- [ ] Hide notification shade; full brightness ~70%.
- [ ] Optional: **Airplane mode ON** for enrollment + attendance to prove offline.
- [ ] Prepare second “worker” (friend) or change appearance slightly if showing two enrollments.
- [ ] Screen recorder: Android built-in, OBS, or scrcpy. Record at 1080p if possible.
- [ ] Mic: quiet room; phone far from fan/AC.

---

## Shot List & Narration

### SCENE 1 — Hook (0:00–0:25)

**Visual:** B-roll of construction site / highway (stock or your own 3–5 sec clip), then cut to GUARD Dashboard on phone.

**On-screen text (optional):**  
`GUARD — Offline Face Attendance for NHAI Sites`

**Voiceover:**
> “At NHAI construction sites, hundreds of workers need to mark attendance every day — often with no reliable internet. Paper registers get faked. Shared PINs get shared. GUARD is an offline-first Android app that verifies *who* is present using face recognition, liveness detection, and a tamper-evident audit chain.”

---

### SCENE 2 — Problem (0:25–0:45)

**Visual:** Dashboard screen — point at **Workers**, **Chain**, **Unsynced** metrics (can be zeros at start).

**Voiceover:**
> “Sites need proof that attendance wasn’t edited after the fact, and that a photo on a phone screen can’t pass as a real worker. GUARD runs entirely on the device: three small AI models, eleven megabytes total, no cloud required at punch-in time.”

---

### SCENE 3 — Enroll Worker (0:45–1:45)

**Visual — follow exactly:**

1. Tap **Enrollment** from Dashboard.
2. Frame your face in the camera preview (centered, neutral expression).
3. Tap **Capture** on **S1** — wait for green ✓ (should be fast, ~1–2 sec).
4. Slightly shift head angle; **Capture S2**.
5. Slight smile or different angle; **Capture S3**.
6. Type worker name: e.g. **“Harsh”** or **“Ramesh Kumar”**.
7. Optional: Labour ID e.g. **“NHAI-042”**.
8. Tap **Save Enrollment** — show success banner: *“✓ … enrolled. Total workers on device: 1”*.

**Voiceover (during capture):**
> “Enrollment takes three face samples. The app detects the face with BlazeFace, builds a 128-dimensional identity template with MobileFaceNet, and stores it encrypted on the device — not as a raw photo.”

**Voiceover (on save):**
> “All three samples are averaged into one template. In our demo we consistently see ninety-plus percent self-match quality before the worker is saved.”

**Tip:** Do not cut away during S1–S3; judges should see speed and green checkmarks.

---

### SCENE 4 — Mark Attendance (1:45–2:45)

**Visual:**

1. Back to **Dashboard** — show **Workers: 1**.
2. Tap **Attendance**.
3. Tap **Mark Attendance**.
4. Read liveness prompt on screen (e.g. blink / smile) — perform it naturally.
5. Tap **Complete Challenge**.
6. Hold still 1–2 seconds while “Processing…” runs.
7. **Success screen:** message like *“Harsh marked at 94% confidence”* and chain counter increment.

**Voiceover:**
> “At punch-in, the worker completes a randomized liveness challenge — blink, smile, head movement — so a printed photo or replayed video is rejected. Then MiniFAS runs a passive anti-spoof check on the face crop. Only if liveness passes does MobileFaceNet compare the live face to enrolled templates.”

**Voiceover (on match):**
> “Here you see a high-confidence match — same person, same session, entirely offline.”

**Optional B-roll:** Split second of you blinking/smiling toward camera (picture-in-picture) while phone shows liveness UI.

---

### SCENE 5 — Chain Audit (2:45–3:15)

**Visual:**

1. **Chain Audit** screen.
2. Tap **Verify Integrity**.
3. Show **Valid** / green status and record count.

**Voiceover:**
> “Every attendance event is appended to a SHA-256 Merkle chain. Each record includes the hash of the previous one. Delete or alter any row and integrity verification fails — that’s the payroll audit trail DBT-style systems need.”

---

### SCENE 6 — Sync (3:15–3:45)

**Visual:**

1. Turn **airplane mode OFF** (quick settings swipe — show briefly).
2. **Sync** screen → **Start Manual Sync**.
3. Show synced count and “purged after ACK” messaging.

**Voiceover:**
> “When connectivity returns, signed batches upload to Datalake. Records are only removed locally after the server sends an acknowledgment — so a dropped connection never loses data mid-sync.”

---

### SCENE 7 — Architecture & Close (3:45–4:30)

**Visual:** Static slide OR quick montage: Dashboard → Enrollment → Attendance → Audit → Sync (2 sec each).

**On-screen bullets:**
- Offline TFLite: BlazeFace + MobileFaceNet + MiniFAS  
- ~11 MB models · mid-range Android  
- MMKV encrypted embeddings  
- Merkle chain + HMAC sync  

**Voiceover:**
> “GUARD integrates into Datalake 3.0 in three steps: drop in the models, initialize the engine with site and device IDs, and mount four screens. We built for NHAI field reality — harsh light, no signal, and auditors who don’t trust editable spreadsheets. Thank you.”

**End card:**  
`github.com/ctrl-shit-del/nhai` · Team name · Hackathon 7.0

---

## Audio Guidelines

| Do | Don't |
|---|---|
| Speak at conversational pace (~130 wpm) | Read bullet lists monotonally |
| Record voiceover in quiet room after screen capture | Record over noisy site audio |
| Use light compression/EQ in CapCut, DaVinci, or Audacity | Leave long silent gaps |
| Add subtle background music at -20 dB under voice | Music louder than narration |

**Export audio:** 48 kHz mono or stereo WAV for editing; final video AAC 192 kbps+.

---

## Recording Tips (Android)

1. **Built-in screen recorder:** Quick Settings → Screen record → enable mic if doing live narration.
2. **Face visible in attendance:** Position phone at eye level, arm’s length.
3. **Show confidence %** on success — it’s the money shot for judges.
4. **One continuous take** for enrollment + attendance is most convincing; edit intro/outro later.
5. If match fails during recording: Dashboard → Clear workers → re-enroll (don’t publish failed take).

---

## Optional 60-Second Teaser Cut

| Time | Content |
|---|---|
| 0–5s | Logo + “Offline face attendance” |
| 5–15s | Fast enroll S1–S3 montage |
| 15–30s | Liveness + “94% matched” |
| 30–40s | Chain Valid |
| 40–50s | Sync complete |
| 50–60s | GitHub URL + tagline |

**Teaser voiceover (single paragraph):**
> “GUARD: enroll with your face offline, prove you’re live not a photo, commit to an unalterable chain, sync when you can. Built for NHAI. Code on GitHub.”

---

## Files to Mention in Description (YouTube / submission)

- Repository: `https://github.com/ctrl-shit-del/nhai`
- README: setup + APK build
- `docs/PRD.md` — requirements
- `docs/INTEGRATION_GUIDE.md` — Datalake mount

---

## Suggested Video Title & Description

**Title:**  
`GUARD — Offline Face Attendance & Merkle Audit Chain | NHAI Hackathon 7.0`

**Description template:**
```
GUARD (Geo-locked Unified Attendance & Recognition for Datalake) is an offline-first Android app for construction site attendance.

Demo shows:
• 3-sample face enrollment (MobileFaceNet)
• Liveness + anti-spoof (MiniFAS)
• Tamper-evident SHA-256 Merkle chain
• Signed sync to Datalake 3.0

Source: https://github.com/ctrl-shit-del/nhai
Build APK: see README → "Build a Standalone APK"
```
