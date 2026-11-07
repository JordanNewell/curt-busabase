# Security Policy

## Supported versions

Only the latest release of the `curt-busabase` package receives security
updates.

## Reporting a vulnerability

Email **security@jordannewell.com** with:

- A description of the issue and its impact
- Reproduction steps (a minimal example is ideal)
- Affected version — run `npm ls curt-busabase`

**Do not open a public GitHub issue** for security reports.

## Response timeline

- **Acknowledgment:** within 72 hours
- **Initial assessment:** within 5 business days
- **Fix or mitigation:** target 30 days for high-severity issues

Please refrain from public disclosure until a fix has been published, to
protect downstream users. Reporters will be credited in the release notes
unless they prefer otherwise.

## Scope

**In scope:**

- The converter (`src/`)
- The CLI (`src/cli.ts`) and its published npm artifacts
- The parse/serialize round-trip guarantees inherited from `curt-format`

**Out of scope:**

- The Busabase platform itself — report upstream to
  [busabase/busabase](https://github.com/busabase/busabase)
- Vulnerabilities in development tooling that never ships to consumers
- Content of conversations encoded in .curt files
