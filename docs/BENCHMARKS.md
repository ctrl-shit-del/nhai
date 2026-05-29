# GUARD Benchmarks

These are planning estimates based on the PRD targets and the intended native TFLite pipeline. They are not measured device results yet. Replace this table with physical-device measurements after Vision Camera and model integration.

| Device | RAM | Detect + preprocess | Liveness | Embed + match @ 500 workers | Total estimate | Notes |
|---|---:|---:|---:|---:|---:|---|
| Redmi Note 10 | 4 GB | 120 ms | 230 ms | 300 ms | 650 ms | Target demo baseline for outdoor noon and pre-dawn runs. |
| Galaxy M21 | 4 GB | 135 ms | 250 ms | 330 ms | 715 ms | Helmet, partial shadow, and dust-mask retry scenario. |
| Realme 7 | 6 GB | 105 ms | 210 ms | 275 ms | 590 ms | Expected best mid-range result; include 2G sync retry timing. |

Estimated sync behavior:

| Scenario | Estimate | PRD relevance |
|---|---:|---|
| 50-record batch assembly | < 50 ms | SY-02 chunked transfer |
| HMAC + checksum generation | < 20 ms | SY-04 signed batch |
| 2G upload, 50 records | 8-20 s | SY-02 2G compatibility |
| Local ACK processing + mark synced | < 50 ms | SY-05 ACK-gated purge |
| Local integrity verification, 500 records | < 150 ms | MC-03 local verification |

Targets from `PRD.md`:

| Metric | Target | Hard limit |
|---|---:|---:|
| Full pipeline latency | < 700 ms | 1000 ms |
| Enrollment per worker | < 30 s | 60 s |
| Model load at app start | < 3 s | 5 s |
| CLAHE overhead | < 20 ms | 40 ms |

Validation checklist before production claim:

- Run all tests on physical Android devices with the final `.tflite` files bundled.
- Capture noon, pre-dawn, shadow, helmet, and dust-mask cases.
- Measure cold model load, warm recognition, enrollment, liveness timeout, and 500-worker matching.
- Record sync timing on throttled 2G/3G and interrupted reconnect flows.
