/**
 * Convert Busabase record review trails to .curt conversations.
 *
 * Busabase is a git-shaped review database for AI-agent content: agents submit
 * change requests (CRs), humans review/approve/merge them, and both sides
 * comment. That trail IS a conversation — agent submissions are assistant
 * turns, human reviews and comments are user turns — so a record's full
 * history round-trips into .curt without inventing structure.
 *
 * Input (offline, read-only — this converter never calls the Busabase API):
 * a directory in the layout produced by `busabase-cli export` or a REST pull:
 *
 *   <dir>/
 *     records/*.json           # Record objects (GET /api/v1/records/get)
 *     change-requests/*.json   # ChangeRequest objects (GET /api/v1/change-requests/{id})
 *     reviews/*.json           # Review objects (CR detail / reviews list)
 *     comments/*.json          # Comment objects (GET /api/v1/comments)
 *
 * Shapes follow busabase.com/openapi (API v1) and are read tolerantly:
 * missing fields are skipped and counted, never fatal. Attribution decides
 * roles: a CR with `sourceAttribution.agent` is an assistant turn (the agent
 * client's name becomes the message `model`); reviews and comments authored
 * by a known agent id are assistant turns, everything else a user turn.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
	type CurtConversation,
	type CurtMessage,
	serializeCurt,
	parseCurt,
} from "curt-format";

export const GENERATOR = "curt-busabase@1.0.0";

export interface BusabaseStats {
	records: number;
	changeRequests: number;
	reviews: number;
	comments: number;
	/** Turns attributed to agents (CR submissions, agent comments). */
	agentTurns: number;
	/** Turns attributed to humans (reviews, human comments, human CRs). */
	humanTurns: number;
	/** JSON files that failed to parse or matched no known shape. */
	unreadable: number;
}

export interface ConvertResult {
	conversation: CurtConversation;
	stats: BusabaseStats;
}

export interface ConvertDirResult {
	items: ConvertResult[];
	converted: number;
	skipped: number;
	totals: BusabaseStats;
}

// ---------- tolerant readers ----------

function asObject(v: unknown): Record<string, unknown> | null {
	return typeof v === "object" && v !== null && !Array.isArray(v)
		? (v as Record<string, unknown>)
		: null;
}

function asString(v: unknown): string | null {
	return typeof v === "string" && v.length > 0 ? v : null;
}

function asStringOrEmpty(v: unknown): string {
	return typeof v === "string" ? v : "";
}

/** ISO-8601 or epoch-ms -> epoch ms; null when unusable. */
function toEpochMs(v: unknown): number | null {
	if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
	if (typeof v === "string") {
		const t = Date.parse(v);
		if (Number.isFinite(t)) return t;
	}
	return null;
}

/** JSON files in a directory; [] when absent. */
function listJson(dir: string): string[] {
	if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
	return readdirSync(dir)
		.filter((n) => n.endsWith(".json"))
		.sort()
		.map((n) => join(dir, n));
}

function loadJson(file: string): Record<string, unknown> | null {
	try {
		const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
		return asObject(parsed);
	} catch {
		return null;
	}
}

// ---------- domain shapes (tolerant slices of the API schemas) ----------

interface RecordObj {
	id: string;
	baseId: string | null;
	title: string | null;
	status: string | null;
	createdAt: number | null;
	updatedAt: number | null;
}

function readRecord(obj: Record<string, unknown>): RecordObj | null {
	const id = asString(obj.id);
	if (!id) return null;
	return {
		id,
		baseId: asString(obj.baseId),
		title: asString(obj.title) ?? asString(obj.name),
		status: asString(obj.status),
		createdAt: toEpochMs(obj.createdAt),
		updatedAt: toEpochMs(obj.updatedAt),
	};
}

interface ChangeRequestObj {
	id: string;
	recordId: string | null;
	status: string | null;
	submittedByUser: string | null;
	/** Agent client attribution — presence marks the submitter as an agent. */
	agentName: string | null;
	agentId: string | null;
	channel: string | null;
	description: string | null;
	operations: string[];
	createdAt: number | null;
	updatedAt: number | null;
}

function readChangeRequest(obj: Record<string, unknown>): ChangeRequestObj | null {
	const id = asString(obj.id);
	if (!id) return null;
	const attribution = asObject(obj.sourceAttribution);
	const agent = attribution ? asObject(attribution.agent) : null;
	const submittedByUser = asObject(obj.submittedByUser);
	const ops = Array.isArray(obj.operations) ? obj.operations : [];
	const operationKinds = ops
		.map((o) => asObject(o))
		.filter((o): o is Record<string, unknown> => o !== null)
		.map((o) => asString(o.operation))
		.filter((k): k is string => k !== null);
	const sourceMeta = asObject(obj.sourceMeta);
	return {
		id,
		recordId: asString(obj.recordId) ?? asString(obj.targetRecordId),
		status: asString(obj.status),
		submittedByUser: submittedByUser ? (asString(submittedByUser.name) ?? asString(submittedByUser.id)) : null,
		agentName: agent ? asString(agent.name) : null,
		agentId: agent ? asString(agent.id) : null,
		channel: attribution ? asString(attribution.channel) : null,
		description:
			(sourceMeta ? asString(sourceMeta.description) ?? asString(sourceMeta.summary) : null) ??
			asString(obj.description) ??
			asString(obj.rejectedReason),
		operations: operationKinds,
		createdAt: toEpochMs(obj.createdAt),
		updatedAt: toEpochMs(obj.updatedAt) ?? toEpochMs(obj.mergedAt) ?? toEpochMs(obj.reviewedAt),
	};
}

interface ReviewObj {
	id: string;
	changeRequestId: string | null;
	reviewer: string | null;
	verdict: string | null;
	reason: string | null;
	createdAt: number | null;
}

function readReview(obj: Record<string, unknown>): ReviewObj | null {
	const id = asString(obj.id);
	if (!id) return null;
	const reviewer = asObject(obj.reviewer);
	return {
		id,
		changeRequestId: asString(obj.changeRequestId),
		reviewer: reviewer ? (asString(reviewer.name) ?? asString(reviewer.id)) : asString(obj.reviewerId),
		verdict: asString(obj.verdict),
		reason: asString(obj.reason),
		createdAt: toEpochMs(obj.createdAt),
	};
}

interface CommentObj {
	id: string;
	subjectId: string | null;
	recordId: string | null;
	changeRequestId: string | null;
	author: string | null;
	authorRole: string | null;
	body: string;
	createdAt: number | null;
}

function readComment(obj: Record<string, unknown>): CommentObj | null {
	const id = asString(obj.id);
	if (!id) return null;
	const author = asObject(obj.author);
	return {
		id,
		subjectId: asString(obj.subjectId),
		recordId: asString(obj.recordId),
		changeRequestId: asString(obj.changeRequestId),
		author: author ? (asString(author.name) ?? asString(author.id)) : asString(obj.authorId),
		authorRole: author ? asString(author.role) : null,
		body: asStringOrEmpty(obj.body),
		createdAt: toEpochMs(obj.createdAt),
	};
}

// ---------- conversion ----------

function stableId(recordId: string): string {
	const hash = createHash("sha256").update(recordId).digest("hex").slice(0, 12);
	return `busabase_record_${hash}`;
}

/**
 * Group CRs, reviews, and comments by record and emit one .curt conversation
 * per record. Records with no trail still convert (empty conversations are
 * skipped — a record nobody touched has no conversation to preserve).
 */
export function convertDir(dir: string): ConvertDirResult {
	const records: RecordObj[] = [];
	const changeRequests: ChangeRequestObj[] = [];
	const reviews: ReviewObj[] = [];
	const comments: CommentObj[] = [];
	let unreadable = 0;

	for (const file of listJson(join(dir, "records"))) {
		const obj = loadJson(file);
		const rec = obj ? readRecord(obj) : null;
		if (rec) records.push(rec);
		else unreadable++;
	}
	for (const file of listJson(join(dir, "change-requests"))) {
		const obj = loadJson(file);
		const cr = obj ? readChangeRequest(obj) : null;
		if (cr) changeRequests.push(cr);
		else unreadable++;
	}
	for (const file of listJson(join(dir, "reviews"))) {
		const obj = loadJson(file);
		const rev = obj ? readReview(obj) : null;
		if (rev) reviews.push(rev);
		else unreadable++;
	}
	for (const file of listJson(join(dir, "comments"))) {
		const obj = loadJson(file);
		const com = obj ? readComment(obj) : null;
		if (com) comments.push(com);
		else unreadable++;
	}

	const items: ConvertResult[] = [];
	const totals: BusabaseStats = {
		records: records.length,
		changeRequests: 0,
		reviews: 0,
		comments: 0,
		agentTurns: 0,
		humanTurns: 0,
		unreadable,
	};

	for (const record of records) {
		const result = convertRecord(record, changeRequests, reviews, comments, totals);
		if (result) items.push(result);
	}

	return { items, converted: items.length, skipped: records.length - items.length, totals };
}

function convertRecord(
	record: RecordObj,
	changeRequests: ChangeRequestObj[],
	reviews: ReviewObj[],
	comments: CommentObj[],
	totals: BusabaseStats,
): ConvertResult | null {
	// CRs attach by explicit recordId; reviews/comments attach through their CR.
	const crsForRecord = changeRequests.filter(
		(cr) => cr.recordId === record.id,
	);
	const crIds = new Set(crsForRecord.map((cr) => cr.id));
	const reviewsForRecord = reviews.filter(
		(rev) => rev.changeRequestId !== null && crIds.has(rev.changeRequestId),
	);
	const commentsForRecord = comments.filter(
		(com) =>
			com.recordId === record.id ||
			(com.changeRequestId !== null && crIds.has(com.changeRequestId)) ||
			(com.subjectId !== null && crIds.has(com.subjectId)),
	);

	// Agent identity across this record's trail.
	const agentIds = new Set<string>();
	const agentNames = new Set<string>();
	for (const cr of crsForRecord) {
		if (cr.agentId) agentIds.add(cr.agentId);
		if (cr.agentName) agentNames.add(cr.agentName);
	}

	interface Turn {
		ts: number;
		role: CurtMessage["role"];
		content: string;
		model?: string;
	}

	const turns: Turn[] = [];

	for (const cr of crsForRecord) {
		const isAgent = cr.agentId !== null || cr.agentName !== null;
		const ops = cr.operations.length > 0 ? ` (${[...new Set(cr.operations)].join(", ")})` : "";
		const desc = cr.description ? `: ${cr.description}` : "";
		const ts = cr.createdAt ?? 0;
		if (isAgent) {
			turns.push({
				ts,
				role: "assistant",
				model: cr.agentName ?? undefined,
				content: `[change request ${cr.status ?? "unknown"}${ops}]${desc}`,
			});
		} else {
			turns.push({
				ts,
				role: "user",
				content: `${cr.submittedByUser ?? "someone"} submitted a change request (${cr.status ?? "unknown"}${ops})${desc}`,
			});
		}
	}

	for (const rev of reviewsForRecord) {
		const reviewerIsAgent =
			(rev.reviewer !== null && agentIds.has(rev.reviewer)) ||
			(rev.reviewer !== null && agentNames.has(rev.reviewer));
		const who = rev.reviewer ?? "someone";
		const why = rev.reason ? `: ${rev.reason}` : "";
		turns.push({
			ts: rev.createdAt ?? 0,
			role: reviewerIsAgent ? "assistant" : "user",
			content: reviewerIsAgent
				? `${who} reviewed ${rev.verdict ?? "on"} the change request${why}`
				: `${who} ${rev.verdict ?? "reviewed"} the change request${why}`,
		});
	}

	for (const com of commentsForRecord) {
		if (!com.body) continue;
		const authorIsAgent =
			com.authorRole === "agent" ||
			(com.author !== null && (agentIds.has(com.author) || agentNames.has(com.author)));
		turns.push({
			ts: com.createdAt ?? 0,
			role: authorIsAgent ? "assistant" : "user",
			model: authorIsAgent ? com.author ?? undefined : undefined,
			content: com.body,
		});
	}

	// A record with no trail has no conversation to preserve.
	if (turns.length === 0) return null;

	turns.sort((a, b) => a.ts - b.ts);
	const messages: CurtMessage[] = turns.map((t, i) => ({
		id: `${stableId(record.id)}_${String(i).padStart(3, "0")}`,
		role: t.role,
		content: t.content,
		timestamp: t.ts,
		...(t.model ? { model: t.model } : {}),
	}));

	const createdAt = record.createdAt ?? messages[0].timestamp;
	const updatedAt = record.updatedAt ?? messages[messages.length - 1].timestamp;
	const conversation: CurtConversation = {
		id: stableId(record.id),
		title: record.title ?? record.id,
		createdAt,
		updatedAt,
		messages,
		provider: "busabase",
		busabase: {
			recordId: record.id,
			baseId: record.baseId,
			recordStatus: record.status,
			changeRequests: crsForRecord.length,
			reviews: reviewsForRecord.length,
			comments: commentsForRecord.length,
		},
	};

	totals.changeRequests += crsForRecord.length;
	totals.reviews += reviewsForRecord.length;
	totals.comments += commentsForRecord.length;
	totals.agentTurns += messages.filter((m) => m.role === "assistant").length;
	totals.humanTurns += messages.filter((m) => m.role === "user").length;

	return { conversation, stats: totals };
}

// ---------- serialization ----------

/** Serialize with a round-trip validation gate; null = spec-invalid, don't write. */
export function serializeValidated(conversation: CurtConversation): string | null {
	const body = serializeCurt(conversation, GENERATOR);
	return parseCurt(body) ? body : null;
}
