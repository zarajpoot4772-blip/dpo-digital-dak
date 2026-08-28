# DPO Digital Dak — Project Review

Review date: 19 August 2026

## Verification completed

- TypeScript static check: passed
- Next.js production build: passed
- npm dependency audit: 0 known vulnerabilities
- Local HTTP login and cookie session: passed
- Automated API/workflow smoke test: 37 checks passed
- Original plus approved document version creation: passed
- Role authorization checks: passed
- Branch dashboard status summary and branch-scoped drill-down: passed
- Return-for-correction and creator resubmission workflow: passed
- First-login password change, expiry and password-history enforcement: passed
- Durable login lockout threshold and persistence path: passed
- Permission-scoped append-only internal file notes: passed

Run the automated workflow test with two terminals:

```bash
# terminal 1
npm run preview

# terminal 2
npm run test:smoke
```

The smoke test uses temporary preview data and creates test records. Restart `npm run preview` before rerunning it.

## Defects corrected in this review

1. **Local login and custom Branch Head login** — development login no longer relies on hard-coded browser credentials. All local users authenticate against the database.
2. **Windows compatibility** — normal `npm run dev` has no Linux-only environment syntax. `cross-env` is used for the Arena preview command, and `START-WINDOWS.bat` is included.
3. **Local session cookie** — HTTP localhost now receives a usable HttpOnly cookie; Secure/Partitioned cookie settings are limited to Arena preview or HTTPS production.
4. **Arena preview isolation** — URL-token proxy behavior is enabled only for Arena preview and is not active in normal local/production operation.
5. **Branch Head schema migration** — existing prototype databases receive the BRANCH_HEAD role constraint safely on startup.
6. **Branch scoping** — Branch Heads see their branch records plus records explicitly forwarded to them; user ID is now used rather than an unreliable branch subquery.
7. **Branch creation consistency** — Branch Head user and branch are created in one database transaction.
8. **Dak creation consistency** — metadata, document, audit action and notification are inserted transactionally; failed requests remove orphan upload files.
9. **Upload hardening** — MIME allowlist is backed by PDF/PNG/JPEG file-signature validation, randomized storage names, safe original names and size checks.
10. **Status transition enforcement** — finalized files cannot be forwarded, only finalized files can be archived, and recipients must be active eligible users.
11. **User lifecycle** — Admin can activate/deactivate users; self-deactivation and removal of the last active DPO are blocked; sessions are revoked on deactivation.
12. **API response handling** — empty/transient responses are retried once and no longer crash the interface with `Unexpected end of JSON input`.
13. **UI controls** — Forward is visible in both document header and action panel; Admin archive action is available; priority filter works; Audit CSV export works.
14. **Dates** — dashboard and New Dak defaults use the current client date/time instead of a hard-coded date.
15. **Caching and security headers** — sensitive APIs use no-store while static application assets are no longer unnecessarily prevented from caching.
16. **Error disclosure** — unexpected server/database errors return a generic 500 response instead of exposing internal details.

## Current role behavior

| Capability | Admin | DPO | Clerk | Officer | Branch Head |
|---|---:|---:|---:|---:|---:|
| Create normal Dak | Yes | No | Yes | No | Own branch only |
| View permitted Dak | All | All office | All office | Assigned | Own branch / forwarded |
| Approve or reject | No | Yes | No | No | No |
| Forward active file | Yes | Yes | No | Assigned | No |
| Add remarks | Yes | Yes | Yes | Assigned | Own/forwarded |
| Archive finalized file | Yes | No | No | No | No |
| Manage branches/users | Yes | No | No | No | No |
| View audit screen | Yes | No | No | No | No |

Admin deliberately does not inherit DPO approval authority.

## Recommended additions

### Priority 1 — before an office pilot

1. **PostgreSQL server migration** — replace embedded PGlite with PostgreSQL 16+, connection pooling and formal migrations.
2. **Durable account lockout in production** — the prototype now stores failed attempts/lock state in its database; production should move this table to managed PostgreSQL with shared policy.
3. **Password recovery policy** — add an approved account-recovery process and administrative separation around resets; first-login change, 90-day expiry and password history are implemented in the prototype.
4. **Two-factor authentication** — TOTP or department-approved identity provider for DPO and Admin.
5. **Malware quarantine** — scan every upload before it becomes visible; verify file structure in addition to magic bytes.
6. **Encrypted storage and backups** — encrypted document volume, daily DB/file backup, off-host copy and documented restore drills.
7. **Audit sealing** — hash-chain or digitally seal audit batches and export to a separate SIEM/log server.
8. **Department PKI** — PAdES/HSM/token integration; retain the current stamp only as a workflow approval.
9. **HTTPS and reverse proxy** — deploy behind IIS/Nginx with a trusted certificate and restricted office LAN/VPN access.
10. **Security assessment** — threat model, penetration test, dependency/SAST scans and signed user-acceptance test.

### Priority 2 — operational value

1. **OCR** for scanned Urdu/English documents, subject to confidentiality policy.
2. **Dispatch/outward Dak** and reply linkage to the original inward Dak.
3. **Bulk scanning/upload queue** with duplicate detection using diary number and document hash.
4. **Configurable workflow templates** for different Dak types and offices.

### Priority 3 — usability and scale

1. Delegation/acting-charge rules with start/end dates.
2. Multi-office tenancy with district/office isolation.
3. Email/SMS integrations only through approved government gateways.
4. Disaster-recovery dashboard and backup verification alerts.

## Known prototype boundaries

- PGlite is for a single-process local prototype; it is not the production database.
- The controlled approval PDF is not a legal PKI signature.
- Malware scanning, full OCR for image-only scans, independent off-site backups and formal PKI signing are not yet implemented; password lifecycle, optional TOTP, password reset and CSV reports are available in the prototype.
- The Arena preview uses temporary in-memory data and preview-specific session transport. Local `npm run dev` uses normal cookie authentication and persistent prototype storage.
- Production deployment must not use seeded demo passwords.
