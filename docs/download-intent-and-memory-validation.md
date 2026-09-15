# Download intent and browser memory validation

Validated locally on 2026-09-15. No production publication or relay upload.

## Download contract

Zillion consumes packaged libp2r2p 0.10.19. NIP-94 decodes an absent download
flag as string `0`, a bare tag as `1`, and accepts explicit `0`/`1`. The builder
omits it unless requested. NIP-27 requires explicit fragment values and retains
those values in ordinary and long nfile URLs. Invalid/duplicate flags are rejected
by the strict decoders. Zillion reads the flag but does not propagate it into new
outgoing metadata, including gallery reuse.

The protected Chrome attachment integration passed in about 50 seconds. It
checked native downloads with exact filenames and disk bytes for flagged images,
videos, composer reply thumbnails, posted quote thumbnails and inline nfile URLs.
Flagged videos remain paused without controls; explicit zero retains controls.
External cards and image URL labels download natively when the controlled server
supplies Content-Disposition. Metadata fragments are stripped from the download
address. During these checks createObjectURL throws if called, so the download
path cannot silently fall back to materializing the file as a Blob.

The same run covered the existing picker, local persistence, gallery, replies,
vault lock/retry, reload, offline bytes, HEAD/ranges, missing files, wrong bridge
and service-worker restart. The test now waits for message geometry and explicitly
returns to the end before checking newly inserted media; it does not confuse an
intentional reading anchor with a failed download preview. Initial permission
recovery waits for the real Retry control instead of clicking before it appears.

Library, Zillion and vault Node suites passed. All 874 launcher Node tests passed;
the loopback server test requires execution outside the filesystem/network
sandbox (its initial EPERM failure was environmental). Relevant lint and local
Zillion/vault builds passed. The vault's generated docs build is updated locally.
Mobile devices, Safari/Firefox and the visible download-manager UI were not
manually exercised in this adjustment.

## Memory investigation

The previous boot journal contains memory-pressure notifications around 11:00,
11:03 and 11:09, but no identified OOM victim. This does not establish which
process caused the reported freeze.

An older self-chat diagnostic contained a 66,657,427-byte vault HTML snapshot:
65,635,138 characters were inside pre elements. Many complete activity entries
repeated approximately 1.7 MB of app icon Base64. The corresponding chat HTML was
618,479 bytes. These are serialized DOM sizes, not process RSS measurements.

ActivityLog eagerly stringified and escaped every full audit entry even when its
details were closed, rebuilt that HTML on each notification, and allowed concurrent
page reads/decryptions before discarding stale results. This is a concrete source
of memory amplification, although it does not prove the cause of the host freeze.
The component now serializes refreshes, keeps a bounded collapsed preview, creates
full JSON only on expansion, and clears it on collapse. Persisted records and their
sealing/retention remain unchanged. The browser verifies empty collapsed JSON,
complete JSON available on expansion and release on collapse.

The shared CDP harness now releases evaluation object groups and file-input
handles, bounds download/chooser/error histories and outstanding commands, and
removes detached target/frame and redundant worker records. The default browser
npm scripts in the launcher and Zillion use a Linux user-systemd service with:

- MemoryMax = 3 GiB for the whole owned tree, including Node, Chrome, launcher,
  vault and build subprocesses;
- MemorySwapMax = 0, OOMPolicy = kill and KillMode = control-group;
- a 15-minute maximum lifetime and a 5-second termination grace period;
- no unbounded fallback, and refusal to reuse a runtime outside that group.

The kernel limits were read back in a small smoke process before restarting
Chrome. The final successful Chrome run had an observed cgroup memory peak of
**1,936 MiB**, with zero swap. Earlier protected attempts also stayed below the
3 GiB limit and exited with test failures, not OOM. The complete launcher Node
suite peaked at approximately 296 MiB. Suites ran one at a time, and the owned
local runtime was stopped after each browser run.

There is no pre-fix RSS trace, controlled before/after benchmark, or proof that
all historical freezes had this cause. The full older browser suite and a physical
machine freeze were not deliberately reproduced. The guard bounds each run;
do not run several browser suites concurrently. Opening many full audit details
still intentionally materializes their requested JSON; storage normalization of
repeated app metadata is outside this correction.

Publication follow-up: the library was released to npm as **0.10.18**. The
launcher and Zillion now pin that registry release; its NIP-27 and NIP-94 sources
match the locally packaged sources validated above. The temporary tarball was
removed from Zillion.
