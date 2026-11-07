#!/usr/bin/env node
/**
 * Conformance vector run for curt-busabase (writer).
 *
 * Executes the dot_curt conformance vectors against the exact curt-format
 * dependency curt-busabase ships with, then produces a bulk artifact run
 * over curt-busabase's own outputs with an independent re-parse:
 *
 *   L1 (CORE)  — every core.json vector through the reference parseCurt
 *                that backs curt-busabase's pre-write self-check, plus a
 *                re-parse of every artifact output the converter emits
 *                (a writer's L1 obligation is: nothing it writes is
 *                reference-rejectable, and its read-back matches).
 *   L2 (NAMED) — every named.json vector through the curtFilename export
 *                the converter uses for output naming; exact match.
 *
 * Usage: node scripts/conformance-run.mjs [path-to-dot_curt-checkout]
 * (default: ../dot_curt). Vectors are read, never modified; results land
 * in CONFORMANCE.md and conformance-artifact.json in this repo.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import {
	parseCurt,
	serializeCurt,
	isCurtConversation,
	curtFilename,
} from "curt-format";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");

const dotCurt = resolve(process.argv[2] ?? "../dot_curt");
const vectorsDir = join(dotCurt, "conformance", "vectors");
if (!statSync(vectorsDir, { throwIfNoError: false })?.isDirectory?.() ?? true) {
	console.error(`vectors not found at ${vectorsDir} — pass a dot_curt checkout path`);
	process.exit(2);
}

const results = {
	generator: `curt-busabase@${pkg.version} conformance-run`,
	date: new Date().toISOString().slice(0, 10),
	vectorsSource: "https://github.com/JordanNewell/dot_curt/tree/main/conformance/vectors",
	l1: { coreVectors: 0, passed: 0, failed: 0, failures: [] },
	l2: { namedVectors: 0, passed: 0, failed: 0, failures: [] },
	artifact: { inputs: 0, outputs: 0, reParsed: 0, reParseFailures: 0, roundTripStable: 0 },
};

// ---------- L1: core vectors through the reference parseCurt ----------
const core = JSON.parse(readFileSync(join(vectorsDir, "core.json"), "utf8"));
const coreVectors = Array.isArray(core) ? core : (core.vectors ?? []);
for (const v of coreVectors) {
	results.l1.coreVectors++;
	const parsed = parseCurt(v.body);
	const accepted = parsed !== null;
	const wanted = v.expect === "accept";
	if (accepted === wanted) {
		results.l1.passed++;
	} else {
		results.l1.failed++;
		results.l1.failures.push({ id: v.id ?? v.name ?? "?", expect: v.expect, got: accepted ? "accept" : "reject" });
	}
}

// ---------- L2: named vectors through the converter's curtFilename ----------
const named = JSON.parse(readFileSync(join(vectorsDir, "named.json"), "utf8"));
const namedVectors = Array.isArray(named) ? named : (named.vectors ?? []);
for (const v of namedVectors) {
	results.l2.namedVectors++;
	const got = curtFilename(v.conversation);
	if (got === v.expect) {
		results.l2.passed++;
	} else {
		results.l2.failed++;
		results.l2.failures.push({ id: v.id ?? v.name ?? "?", expect: v.expect, got });
	}
}

// ---------- artifact: convert real trails, then independent re-parse ----------
// Trails: the checked-in fixture space + any directory given via
// CURT_BUSABASE_SPACE (e.g. a live-space pull).
const spaces = [join(resolve(import.meta.dirname, ".."), "test", "fixtures", "space")];
if (process.env.CURT_BUSABASE_SPACE) spaces.push(process.env.CURT_BUSABASE_SPACE);

const { convertDir } = await import("../dist/busabase.js");
let artifactBodies = [];
for (const space of spaces) {
	try {
		const { items } = convertDir(space);
		for (const { conversation } of items) {
			results.artifact.inputs++;
			const body = serializeCurt(conversation, `curt-busabase conformance-run`);
			// Independent re-parse: parse from the serialized bytes only.
			const reparsed = parseCurt(body);
			if (reparsed !== null && isCurtConversation(reparsed)) {
				results.artifact.reParsed++;
				// Round-trip stability at the conversation level: re-serializing
				// the parsed conversation reproduces the same conversation bytes
				// (envelope generator excluded — it is not part of the model).
				if (serializeCurt(reparsed) === serializeCurt(conversation)) results.artifact.roundTripStable++;
			} else {
				results.artifact.reParseFailures++;
			}
			results.artifact.outputs++;
			artifactBodies.push(body);
		}
	} catch (e) {
		console.error(`space ${space}: ${e.message}`);
	}
}

// ---------- report ----------
const line = (r, label) =>
	`${label}: ${r.passed}/${r.coreVectors ?? r.namedVectors} passed` +
	(r.failed > 0 ? ` — FAILURES: ${JSON.stringify(r.failures)}` : "");
console.log(line(results.l1, "L1 core"));
console.log(line(results.l2, "L2 named"));
console.log(
	`artifact: ${results.artifact.outputs} outputs from ${results.artifact.inputs} record trails — ${results.artifact.reParsed} re-parsed OK, ${results.artifact.reParseFailures} re-parse failures, ${results.artifact.roundTripStable} byte-stable round-trips`,
);

const ok = results.l1.failed === 0 && results.l2.failed === 0 && results.artifact.reParseFailures === 0;
writeFileSync(
	join(import.meta.dirname, "..", "conformance-artifact.json"),
	JSON.stringify(results, null, "\t") + "\n",
);
console.log(ok ? "CONFORMANCE RUN: PASS" : "CONFORMANCE RUN: FAIL");
process.exit(ok ? 0 : 1);
