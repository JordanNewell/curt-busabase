# Conformance

curt-busabase is a **writer**: it emits `.curt` files and never reads
arbitrary ones. Its conformance obligation is that nothing it writes is
reference-rejectable, and that its output naming implements the spec
algorithm exactly.

Run: `node scripts/conformance-run.mjs <path-to-dot_curt-checkout>`
(default `../dot_curt`). Results land in `conformance-artifact.json`.

## Latest run (2026-11-07, curt-busabase@1.0.1, curt-format@1.2.0)

| Level | Result |
|---|---|
| **L1 CORE** | 13/13 vectors accept/reject exactly through the shipped reference `parseCurt` (the same call that gates every write) |
| **L2 NAMED** | 7/7 vectors — output naming via the shipped `curtFilename` is an exact match |
| **L3 BULK** | not claimed — the converter writes individual files, not zips |
| **Artifact** | 3 record trails (fixture space + a live self-hosted Busabase pull) → 3 outputs, 100% independent re-parse, 3/3 byte-stable conversation round-trips |

The artifact's real-space input includes the converter's own ship
announcement record (see
[demos/real-announcement/](demos/real-announcement/)).

Vectors are never modified by the run; claims are reproducible from
[dot_curt/conformance/vectors](https://github.com/JordanNewell/dot_curt/tree/main/conformance/vectors).
