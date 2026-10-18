# Messaging performance validation

Release: libp2r2p 0.11.24. The exact prepared npm archive was validated in all
three consumers, then published manually. Final manifests and lockfiles resolve
the published registry archive, whose integrity matches the validated archive:

```text
sha512-Mc69IBvw0RzD0dKED/OtxlxD2lciqmc/hkJsuoMg4ipITPUPl/UCKNWFEPvMqx55UVyJry+kbJwcdk9PzyEVpQ==
```

No local dependency references are committed.

## Controlled processor comparison

A Node harness compared the prior 0.11.23 session with the candidate, using
in-memory persistence and a simulated 100 ms remote publication. Twelve samples
per scenario: self completion behind publication fell from about 99 ms median
to 1.2 ms; idle completion remained about 1.3 ms. These demonstrate scheduling
isolation only, not real cryptography, disk or browser performance.

## Chrome integration

Disposable profile, real launcher/vault/signers/permissions/IndexedDB, controlled
remote relay boundary, development diagnostics enabled. Each scenario measures
eight self and remote sends. Browser results below use the median of both middle
samples; p95 is nearest-rank (the maximum with eight samples).

| Scenario | Self median ms | Self p95 ms | Remote median ms | Remote p95 ms |
|---|---:|---:|---:|---:|
| idle | 181.9 | 221.3 | 7885.5 | 8141.9 |
| history | 269.9 | 346.0 | 7952.9 | 8073.9 |
| file-transfer | 359.6 | 395.8 | 8106.5 | 11798.4 |

Remote timings include blocked external discovery and content-key advertisement
in this controlled fixture; they are not representative real-network delivery
benchmarks. The history case launches actual personal-copy decryptions alongside
sends; it is an initial burst, not a continuously saturated history replay. The
transfer case starts a real 1 MiB IRFS transfer and samples while it runs.

The same run verified self commit while a remote ACK is held, continued live
reception during that wait, late positive ACK completion, replies and private
channel delivery. Peak cgroup memory was 1733 MiB (3072 MiB hard limit, no swap).

A separate protected Chrome run verified the order of twelve same-second
messages through saved confirmation and an offline document reload. Peak memory
was 1602 MiB. Deterministic suites cover the queue limits, timeouts, connection
replacement, checkpoint failures, cleanup retries, idempotent replay and session
shutdown. The complete Node suites passed in all four repositories.

Production builds also passed using the registry-resolved lockfiles, including
the launcher's standard preparation/install/build sequence for the sibling vault.
Every installed library file in the three consumers was compared with the
validated archive. The short fixed-wait relay attach test failed once under
simultaneous suite load, then passed both alone and in the complete launcher
suite; no unrelated relay behavior was changed to accommodate it.

The fixture grants actual permissions one kind at a time and waits for the native
dialog close between calls. This avoids rejecting the next operation through a
previous close event; production permission/dialog behavior is unchanged.

Reproduce sequentially, with no runtime outside the protected memory group:

```sh
node ../../44billion/bin/run-browser-tests.js -- node tests/browser/self-chat.browser.js --private-performance-only
node ../../44billion/bin/run-browser-tests.js -- env ZILLION_ORDER_ONLY=1 node tests/browser/self-chat.browser.js
```

Real PC hibernation and timings on a low-powered device still require a manual
check. The diagnostic stages separate outbox encryption/admission, local work,
vault queue/execution, quota-lock wait/execution, publication and bubble updates
so remaining delays can be attributed without guessing from relay-pool counters.
