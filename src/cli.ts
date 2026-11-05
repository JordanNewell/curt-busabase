#!/usr/bin/env node
/** curt-busabase CLI: Busabase record review trails -> .curt files. */

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { curtFilename } from "curt-format";
import {
	GENERATOR,
	convertDir,
	serializeValidated,
} from "./busabase.js";

interface Options {
	outDir?: string;
	stdout: boolean;
}

function usage(): never {
	console.error(`curt-busabase — Busabase record review trails -> .curt files

Usage:
  curt-busabase <spaceDir>
  curt-busabase <spaceDir> -o ./out
  curt-busabase <spaceDir> --stdout > one.curt

Input is a directory laid out as busabase-cli export / a REST pull produces:
  <dir>/records/*.json            Record objects (GET /api/v1/records/get)
  <dir>/change-requests/*.json    ChangeRequest objects
  <dir>/reviews/*.json            Review objects
  <dir>/comments/*.json           Comment objects (GET /api/v1/comments)

Read-only and offline — never calls the Busabase API, never reads credentials.
One .curt conversation per record: agent change requests are assistant turns,
human reviews and comments are user turns. Records with no trail are skipped.

Options:
  -o, --out <dir>       Output directory (default: alongside the input dir)
  --stdout              Print .curt bodies to stdout instead of writing files
  -h, --help            Show this help`);
	process.exit(2);
}

function parseArgs(argv: string[]): { input: string; options: Options } {
	const options: Options = { stdout: false };
	let input: string | undefined;
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "-h" || a === "--help") usage();
		if (a === "--stdout") {
			options.stdout = true;
		} else if (a === "-o" || a === "--out") {
			const v = argv[++i];
			if (!v) usage();
			options.outDir = v;
		} else if (a.startsWith("-")) {
			console.error(`Unknown option: ${a}`);
			usage();
		} else if (input === undefined) {
			input = a;
		} else {
			console.error(`Unexpected extra argument: ${a}`);
			usage();
		}
	}
	if (input === undefined) usage();
	return { input, options };
}

function main(): number {
	const { input, options } = parseArgs(process.argv.slice(2));
	const dir = resolve(input);

	const { items, converted, skipped, totals } = convertDir(dir);

	let roundtripFailures = 0;
	for (const { conversation } of items) {
		const body = serializeValidated(conversation);
		if (!body) {
			roundtripFailures++;
			console.error(`round-trip validation failed for ${conversation.id}; not written`);
			continue;
		}
		if (options.stdout) {
			console.log(body);
		} else {
			const outDir = resolve(options.outDir ?? dir);
			mkdirSync(outDir, { recursive: true });
			const file = join(outDir, curtFilename(conversation));
			writeFileSync(file, body);
			console.log(file);
		}
	}

	console.error(
		`${GENERATOR}: ${converted} converted, ${skipped} skipped (no trail), ${roundtripFailures} round-trip failures` +
			` (turns: ${totals.agentTurns} agent / ${totals.humanTurns} human; ` +
			`${totals.changeRequests} change requests, ${totals.reviews} reviews, ${totals.comments} comments; ` +
			`${totals.unreadable} unreadable files)`,
	);
	// Per-record problems are counted, never fatal.
	return 0;
}

process.exitCode = main();
