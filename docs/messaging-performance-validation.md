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


## Prepublication changes: 0.11.25 (2026-10-18)

The exact candidate archive was installed and compared byte-for-byte in all three
consumers. Complete Node suites, source lint and production builds passed. Browser
runs used the protected harness sequentially, with disposable profiles, real
vault/signers/event store/IndexedDB and a controlled relay boundary. Eight paired
self/remote sends per scenario; median averages the middle two and nearest-rank
p95 is the maximum. Historical 0.11.24 figures above are the before comparison.

| Scenario | Before remote bubble median / p95 ms | New first ACK median / p95 ms | New remote bubble median / p95 ms | New self median / p95 ms |
|---|---:|---:|---:|---:|
| idle | 7885.6 / 8141.9 | 396.7 / 449.6 | 404.2 / 457.4 | 157.1 / 247.7 |
| history | 7952.9 / 8073.9 | 425.4 / 690.0 | 431.6 / 698.0 | 238.7 / 322.1 |
| file-transfer | 8106.4 / 11798.4 | 696.8 / 922.4 | 713.8 / 928.5 | 326.5 / 607.8 |

The historical run did not retain per-send first-ACK times, so no before-ACK
comparison is claimed. External discovery/own-key advertisements are deliberately
unavailable in this fixture. This demonstrates removal of those waits from the
critical path, not a prediction of production relay latency or a three-second
delivery guarantee. History is a concurrent initial decryption burst; the file
case starts the same real 1 MiB IRFS transfer as the prior run.

Correlated development traces for all eight remote samples in each case:

| Scenario | Envelope preparation median / p95 ms | Minimal checkpoint median / p95 ms | Publisher-to-first-ACK median / p95 ms |
|---|---:|---:|---:|
| idle | 35.5 / 105.0 | 5.5 / 23.0 | 1.7 / 3.6 |
| history | 27.0 / 102.0 | 6.5 / 13.0 | 1.7 / 2.7 |
| file-transfer | 39.0 / 104.0 | 8.5 / 101.0 | 1.8 / 2.6 |

The bounded diagnostic tail also captured local-store medians of 150 / 164 / 255
ms (6 / 7 / 5 samples). Selected quota-lock waits reached 134.8 ms p95 during the
history burst; the small captured vault-queue sample had zero wait. These partial
stage samples are diagnostic evidence, not complete queue distributions. Stages
can overlap and their medians must not be added. Local persistence and quota-lock
contention remain measurable costs; changing the global quota lock is outside
this delivery. Raw bounded aggregates are in the release's browser-performance.json.

Integration verified two consecutive texts and bubble completion while the real
indexed recovery-write boundary was held, self persistence and live reception
while an outgoing ACK was held, late acceptance, and concurrent file transfer.
Separate runs covered click-based fallback (152 ms preparation; fallback at 3002
ms after click), fast primary success, failures/retry/toast ownership, native
network pause with local self-send and automatic reconnection, and offline reload
with twelve ordered messages. Direct vault synchronization passed in two isolated
contexts, including key recovery without blocking newer delivery, overflow,
lock/unlock and reload. Browser cgroups stayed below 3 GiB with zero swap.

The feedback test's former 25s reconnection wait was too close to existing
connectivity backoff: the published 0.11.24 control took 24.7s, and the final
candidate took 25.3s. The test now allows 45s; connectivity policy was not changed.
This budget is separate from the send fallback deadline.

Deterministic tests additionally cover checkpoint failure/no transmission, exact
signed-envelope replay, archival failure after ACK, pending-seed reads, concurrent
ACK checkpoints, upload yielding, cancellation and close. Actual snapshots
captured with 0.11.24 cover initial intent, acknowledged context and a partially
published upload; upgrades preserve event identity and local/file progress through
the single current pipeline. Own-key jobs cover pinned keys, coalescing, bounded
backoff, offline/lifecycle cancellation and derived identities.

The version was published manually. The downloaded npm archive is byte-for-byte
identical to the validated candidate (SHA-256
`400f2a2e2c80ed48803ded902ba75e7e5c6b34491b39a40bb9074e92541f817c`).
All three manifests and lockfiles resolve 0.11.25 through registry URLs with its
verified integrity; no local dependency references remain. Production builds
passed through the normal launcher preparation/install/vault-build sequence and
the Zillion build. The installed library's 113 files match the published archive
in each consumer. No real PC hibernation or low-powered-device production
benchmark was performed here.


## Connectivity and quota coordination: 0.11.26 (2026-10-19)

Five protected Chrome recovery cycles used real vault/signer/event-store/outbox
and controlled connectivity without a native online event. Development diagnostics
correlate network confirmation and first ACK to the same outgoing event; probes
from other realms are not used as its detection timestamp. Median / nearest-rank
p95 from network restoration, in milliseconds:

| Confirmed connectivity | Observed pause release | First ACK | Saved bubble |
|---:|---:|---:|---:|
| 4230 / 4322 | 4258 / 4379 | 4285 / 4360 | 4367 / 4418 |

The previous 0.11.25 control captured one 25,281 ms bubble sample, not a comparable
five-sample distribution. The new run also exercises manual retry, cancellation
of one of multiple durable network waits and self-chat while paused. A separate
sample restores connectivity more than 31 seconds after the last manual retry:
backoff probes explicitly report zero remaining urgency; detection takes 3835 ms
and bubble confirmation 3960 ms in that sample. An outage beyond the window waits
for ordinary backoff or new user intent. These are controlled observations, not a
five-second delivery guarantee. Pause release is polled and can be observed just
after an ACK; the session resumes publication before the next browser poll.

The same eight-pair fixture as 0.11.25 produced these median / p95 values (ms):

| Scenario | Previous first ACK | New first ACK | Previous remote bubble | New remote bubble | New self |
|---|---:|---:|---:|---:|---:|
| idle | 396.7 / 449.6 | 379.7 / 543.7 | 404.2 / 457.4 | 387.6 / 554.6 | 134.1 / 202.6 |
| history | 425.4 / 690.0 | 466.2 / 601.1 | 431.6 / 698.0 | 474.8 / 609.1 | 271.1 / 317.3 |
| file-transfer | 696.8 / 922.4 | 704.7 / 833.2 | 713.8 / 928.5 | 714.8 / 844.1 | 366.2 / 631.2 |

These small distributions do not establish a uniform send-latency improvement
from the conservative quota changes. The bounded trace captured quota-wait p95s
of 102.8 / 34.1 / 201.0 ms with only 6 / 3 / 2 samples, respectively. Compare them
cautiously with the previous incomplete history sample (134.8 ms p95, n=5).
They are not complete quota-wait distributions and stages overlap. Admission still
sums cross-account counters under its global lock; crypto/vault queues, disk and
physical relay recovery remain independent sources of delay.

Deterministic tests and two-tab Chrome tests establish that access statistics
finish while the global quota lock is held, use transactions of at most 25,
discard old connection generations and revalidate LRU races. Periodic cleanup
releases its lock after at most 100 examinations / 25 deletions; admission remains
atomic. Other protected runs verified read-only/removal lifecycle, live reception
while outgoing ACK is held, consecutive sends with archival blocked and direct
vault synchronization with lock/unlock, overflow and reload. Peak browser memory
stayed below 2.3 GiB under the 3 GiB/no-swap guard.

Complete deterministic suites passed in all four projects. Changed-source lint
passed, as did Zillion's configured lint and tracked-JS lint in library/vault.
Broader launcher src/bin/tests lint reports 14 pre-existing errors in five files
unchanged from HEAD (old loader/layout and unrelated tests); no unrelated lint
cleanup is included. The exact 0.11.26 archive was compared against all 113 installed package files in each
consumer. Archive integrity, raw aggregates and publication instructions are in
`/tmp/zillion-recovery-quota-release/RELEASE.md`.

The version was published manually. Its downloaded registry archive matches the
validated tarball byte-for-byte (SHA-256
`ffe4246d8bc85956282b07626c9e440c0d9100947501de8708a81ad98a6fbbe4`).
All three consumers now resolve 0.11.26 through npm URLs with the verified
integrity and no local dependency references. All 113 packaged files were checked
again after registry installation, including the installed package resolution.
Normal production builds passed, including the launcher's ordinary preparation,
installation and sibling-vault build sequence. Full consumer suites passed again
after reinstalling from npm: launcher 1180 cases, vault 50 files, Zillion 46 files.
The first launcher build loaded the old esbuild host before preparation replaced
its binary; rerunning the normal build after installation completed passed without
source or dependency changes. Real hardware hibernation and a low-powered device
still require manual verification.

Additional reproduction (run sequentially):

```sh
node ../../44billion/bin/run-browser-tests.js -- node tests/browser/send-feedback.browser.js
node ../../44billion/bin/run-browser-tests.js -- env ZILLION_RECOVERY_AFTER_WINDOW=1 node tests/browser/send-feedback.browser.js
```

## Independent persistence and traffic scheduling: 0.11.27 (2026-10-19)

The version was published manually. The downloaded npm archive matches the
prepared tarball byte-for-byte (SHA-256
`ac3c90592b5d33f1649c841f5b2525bfec9257d93ab388f8522fcb3fa3a1b17d`). All three
consumers resolve 0.11.27 through npm URLs with the verified integrity, including
their installed-package locks. All 113 packaged files match the archive in every
consumer. The release record is `/tmp/zillion-send-cost-release/RELEASE.md`; raw
before/after browser logs and aggregates are in the same directory.

The before checkout uses the published 0.11.26 library and the previous launcher,
vault and app sources. Both runs use the same protected Chrome harness, disposable
profiles, actual permissions, vault, signer, encrypted outbox and IndexedDB. The
remote boundary is controlled: accepted publications receive an immediate ACK.
These figures therefore measure preparation and scheduling, not production relay
latency. No other test suites ran during either measurement.

There are eight paired self/remote samples per condition and eight isolated self
samples. Each pair waits for its outbox cleanup before the next pair, so the faster
remote completion does not change the next sample's initial backlog. The history
case starts actual personal-copy decryptions; the upload case starts a 1 MiB IRFS
transfer. Neither is a permanently saturated load. Durations begin at the session
send call. Median averages the middle two; nearest-rank p95 is the maximum.

| Condition | Before first ACK median / p95 ms | Candidate first ACK median / p95 ms | Before remote bubble median / p95 ms | Candidate remote bubble median / p95 ms |
|---|---:|---:|---:|---:|
| idle | 293.3 / 382.3 | 151.4 / 176.7 | 304.5 / 391.5 | 161.3 / 189.6 |
| history | 394.2 / 437.6 | 179.9 / 277.5 | 403.3 / 446.8 | 192.2 / 301.6 |
| file transfer | 552.8 / 760.0 | 266.3 / 403.5 | 564.8 / 768.9 | 292.0 / 419.6 |

| Local completion condition | Before median / p95 ms | Candidate median / p95 ms |
|---|---:|---:|
| isolated self-chat | 58.3 / 121.1 | 65.1 / 111.6 |
| paired, idle | 124.3 / 216.9 | 142.8 / 233.9 |
| paired, history | 170.3 / 202.6 | 151.5 / 332.7 |
| paired, file transfer | 249.1 / 360.5 | 319.6 / 477.2 |

Remote ACK medians fell by roughly 48–54% in this controlled run. Local completion
did not improve uniformly; the paired upload case worsened. Independent local and
remote work competes for the same vault and disk, and these small samples do not
establish a local speedup. The change removes the mandatory local-before-remote
dependency; it does not eliminate local contention or guarantee delivery times.
Bounded per-stage traces are partial and overlap, so they must not be summed or
presented as complete queue/quotas distributions.

The exact candidate passed Chrome checks for consecutive messages, live reception
with an ACK held, ACK completion with local storage blocked, persistent notice
after a local failure, and local-only retry without retransmitting the prepared
envelopes. Recovery archival can remain blocked while bubbles stay confirmed.
The measurement run peaked at 2402 MiB under the 3072 MiB/no-swap limit.

A separate real-bridge Chrome scenario holds receive credits while history fills
the queue. A correlated publication ACK bypasses queued history in both the app
and vault shims; releasing credits still delivers every history event in order
before EOSE. Deterministic tests cover host-wide weights/reservations, saturated
normal progress, authentication, large frames, cancellation and credit ledgers.

Session tests also cover failed checkpoints, old encrypted outbox fixtures,
separate stage failures, monotonic delivery confirmation, shutdown and a local
tombstone arriving while an envelope checkpoint is blocked. A local failure stays
visible through retry admission until a successful commit; old permanent local
failures preserve their manual-retry policy after upgrading.

Cache tests use controlled buffers and nonces to verify crypto equivalence,
fresh normal nonces, bounded LRU/expiry, protocol/signer isolation, zeroization,
revocation during preparation, stable primitive references and absence of secret
material in public properties or diagnostics. Personal-copy tests verify actual
overlap, at most four operations per preparation and unchanged tag order.

Full deterministic suites passed: library 73 test files, launcher 1188 cases,
vault 388 cases and Zillion 385 cases. Changed/new-file lint passes, along with
the vault/library JavaScript checks and Zillion's configured lint. Broad launcher
lint still reports 14 pre-existing errors in five unchanged files. Production
bundles passed using the exact candidate; only the launcher's preparation
installer was replaced by a temporary test wrapper to prevent restoring 0.11.26.
The ordinary preparation/build will be repeated after registry publication.

Direct vault synchronization passed in two isolated real launcher/vault contexts,
including private contacts, self-chat, old-key recovery, live overflow, lock/unlock
and reload. Its protected Chrome run peaked at 2380 MiB without swap.
The separate send-feedback run also passed repeated offline/reconnect cycles;
its peak was 1972 MiB with no swap. All browser runs were sequential.

Real PC hibernation, low-powered hardware and public-relay production timing still
require manual verification. Ordinary production builds passed after registry
installation, including the launcher's full dependency preparation and sibling
vault build. Full consumer suites passed again: launcher 1188 cases, vault 388
cases and Zillion 385 cases. Manifests and committed lockfiles changed only the
library dependency from 0.11.26 to 0.11.27; no local library references remain.

The protected Chrome scenario passed again after registry installation and normal
production builds, with 2307 MiB peak and no swap. The repeated eight-sample
measurements below are retained separately in `registry-performance.json` and
`registry-browser.log`; earlier prepublication results above are not overwritten.
The controlled boundary and small-sample limitations still apply. Isolated
self-chat measured 40.3 / 122.0 ms median / p95 in this repeat.

| Condition | Registry first ACK median / p95 ms | Registry remote bubble median / p95 ms | Registry paired self median / p95 ms |
|---|---:|---:|---:|
| idle | 136.3 / 378.1 | 153.7 / 400.9 | 148.9 / 289.7 |
| history | 230.2 / 301.2 | 249.1 / 321.4 | 168.0 / 323.7 |
| file transfer | 260.7 / 432.4 | 283.1 / 451.1 | 272.8 / 421.1 |
