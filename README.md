# curt-busabase

Convert [Busabase](https://busabase.com) record review trails into
[`.curt`](https://github.com/JordanNewell/dot_curt) single-file conversation
format. Built on [`curt-format`](https://www.npmjs.com/package/curt-format)
(reference implementation, v1 core). Part of the `curt-*` converter family
(`curt-convert` for Claude Code, `curt-openclaw` for OpenClaw, `curt-hermes`
for Hermes, `curt-codex` for Codex, `curt-wildchat` for WildChat-1M).

Busabase is a git-shaped review database for AI-agent content: agents submit
change requests, humans review/approve/merge them, both sides comment. That
trail **is** a conversation — so this converter preserves it as one, instead
of leaving it locked in a vendor's schema.

```sh
npm install -g curt-busabase   # or: npx curt-busabase
curt-busabase ./my-space-export -o ./out
curt-busabase ./my-space-export --stdout > one.curt
```

## Input

Offline and read-only — the CLI never calls the Busabase API and never reads
credentials. Point it at a directory in the layout `busabase-cli export` or a
plain REST pull produces (`busabase.com/api/v1/openapi.json`):

```
<dir>/
  records/*.json           # Record objects       (GET /api/v1/records/get)
  change-requests/*.json   # ChangeRequest objects (GET /api/v1/change-requests/{id})
  reviews/*.json           # Review objects        (CR detail / reviews list)
  comments/*.json          # Comment objects       (GET /api/v1/comments)
```

A one-record pull is enough:

```sh
curl -H "Authorization: Bearer $BUSABASE_API_KEY" \
  "$BASEURL/api/v1/records/get?recordId=rec_001" > records/rec_001.json
curl -H "Authorization: Bearer $BUSABASE_API_KEY" \
  "$BASEURL/api/v1/records/rec_001/change-requests" > change-requests/cr_001.json
```

## Mapping

| Busabase | .curt |
|---|---|
| Record | conversation (`id: busabase_record_<hash>`, title from the record, Busabase ids under a `busabase` extra) |
| Agent change request (`sourceAttribution.agent`) | assistant turn (agent client name as `model`) |
| Human-submitted change request | user turn |
| Review | user turn (`<reviewer> <verdict> the change request: <reason>`) |
| Comment by human | user turn |
| Comment by agent | assistant turn |

Turns are emitted chronologically. Shapes are read tolerantly: missing or
unrecognized fields are skipped and counted in the run summary, never fatal.

## Known losses

- Record field values (table cells) are not conversation turns — they live in
  the record, not the trail. Provenance (base id, record status, counts) is
  carried on the conversation's `busabase` extra instead.
- Workflow runs and audit events outside the CR/review/comment trail are out
  of scope for v1.
- Attachments are referenced by the trail but their bytes are not embedded.

## Contributing

Bug reports and pull requests welcome in
[Issues](https://github.com/JordanNewell/curt-busabase/issues). For real-space
trails that convert badly, attach the JSON slice (redact anything sensitive)
— tolerant readers improve by what they fail on. Security reports: see
[SECURITY.md](SECURITY.md).

## License

MIT — see [LICENSE](LICENSE).
