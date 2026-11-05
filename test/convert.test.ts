import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { parseCurt } from "curt-format";
import { GENERATOR, convertDir, serializeValidated } from "../src/busabase.js";

const fixtureSpace = join(__dirname, "fixtures", "space");

describe("convertDir", () => {
	it("converts a record trail into one conversation with ordered roles", () => {
		const { items, converted, skipped } = convertDir(fixtureSpace);

		expect(converted).toBe(1);
		expect(skipped).toBe(0);
		expect(items).toHaveLength(1);

		const { conversation } = items[0];
		expect(conversation.id).toMatch(/^busabase_record_[0-9a-f]{12}$/);
		expect(conversation.title).toBe("Q4 launch post");
		expect(conversation.provider).toBe("busabase");
		expect(conversation.createdAt).toBe(Date.parse("2026-10-20T10:00:00.000Z"));
		expect(conversation.updatedAt).toBe(Date.parse("2026-10-21T09:30:00.000Z"));

		// Chronological: cr_001 (10:05) -> Sarah comment (11:00) -> Sarah
		// review (12:00) -> cr_002 (09:00 next day) -> Andy comment (09:05).
		const roles = conversation.messages.map((m) => m.role);
		expect(roles).toEqual(["assistant", "user", "user", "assistant", "assistant"]);

		expect(conversation.messages[0].model).toBe("Andy");
		expect(conversation.messages[0].content).toContain("[change request merged (record_create)]");
		expect(conversation.messages[0].content).toContain("record_create");
		expect(conversation.messages[1].content).toContain("Tighten the lede");
		expect(conversation.messages[2].content).toBe("Sarah approve the change request: Ship it");
		expect(conversation.messages[3].content).toContain("[change request approved (record_update)]");
		expect(conversation.messages[4].model).toBe("Andy");
	});

	it("carries busabase provenance extras", () => {
		const { items } = convertDir(fixtureSpace);
		const extras = items[0].conversation.busabase as Record<string, unknown>;
		expect(extras).toMatchObject({
			recordId: "rec_001",
			baseId: "base_blog",
			recordStatus: "active",
			changeRequests: 2,
			reviews: 1,
			comments: 2,
		});
	});

	it("reports stats including unreadable files", () => {
		const { totals } = convertDir(fixtureSpace);
		expect(totals.records).toBe(1);
		expect(totals.changeRequests).toBe(2);
		expect(totals.reviews).toBe(1);
		expect(totals.comments).toBe(2);
		expect(totals.agentTurns).toBe(3);
		expect(totals.humanTurns).toBe(2);
		expect(totals.unreadable).toBe(0);
	});

	it("skips records with no trail", () => {
		const dir = mkdtempSync(join(tmpdir(), "curt-busabase-"));
		mkdirSync(join(dir, "records"), { recursive: true });
		writeFileSync(
			join(dir, "records", "lonely.json"),
			JSON.stringify({ id: "rec_lonely", createdAt: "2026-10-20T10:00:00.000Z" }),
		);
		const { items, converted, skipped } = convertDir(dir);
		expect(items).toHaveLength(0);
		expect(converted).toBe(0);
		expect(skipped).toBe(1);
	});

	it("counts malformed files as unreadable, never fatal", () => {
		const dir = mkdtempSync(join(tmpdir(), "curt-busabase-"));
		mkdirSync(join(dir, "records"), { recursive: true });
		mkdirSync(join(dir, "comments"), { recursive: true });
		writeFileSync(join(dir, "records", "bad.json"), "{not json");
		writeFileSync(
			join(dir, "records", "shapeless.json"),
			JSON.stringify({ nope: true }),
		);
		writeFileSync(
			join(dir, "comments", "bad.json"),
			JSON.stringify({ author: "x" }),
		);
		const { totals } = convertDir(dir);
		// bad.json and shapeless.json fail record reads; comments/bad.json fails comment read.
		expect(totals.unreadable).toBe(3);
	});

	it("round-trips through parseCurt with the generator stamp", () => {
		const { items } = convertDir(fixtureSpace);
		const body = serializeValidated(items[0].conversation);
		expect(body).not.toBeNull();
		expect(body).toContain(GENERATOR);
		const parsed = parseCurt(body as string);
		expect(parsed).not.toBeNull();
		expect(parsed?.messages).toHaveLength(5);
		// Unknown conversation fields survive the round trip.
		expect((parsed as { busabase?: unknown } & { messages: unknown[] }).busabase).toBeDefined();
	});
});
