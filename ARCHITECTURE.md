# Architecture and Workflow Review

## 1. System boundary

Desktop-first intranet application. Browser clients never access document storage or the database directly. All metadata and bytes pass through authenticated application routes.

```text
Office client ──HTTPS/LAN── Reverse proxy ── Next.js application
                                            ├── PostgreSQL
                                            ├── Private original store (read-only policy)
                                            ├── Private derived-version store
                                            └── backup / audit export targets
```

The local prototype combines the application and embedded PostgreSQL-compatible store (PGlite) in one process. Setting `DATABASE_URL` switches the same SQL to a pooled `pg` adapter against a managed PostgreSQL 16+ server; the adapter boundary lives in `lib/db.ts`. Production separates these concerns.

## 2. Modules

- Identity and session management
- RBAC/policy enforcement
- Dak registry and unique diary control
- Private upload/version storage
- Inbox/search/dashboard
- Document authorization and streaming
- Workflow/state transition service
- Controlled approval PDF generation
- Forwarding/custody tracking
- Append-only action audit trail
- In-app notifications
- Branch dashboard and workload analytics
- Return-for-correction workflow
- Internal file noting sheet
- Outward dispatch register and reply linkage
- Duplicate upload detection
- Administrative users

## 3. State machine

```text
PENDING ──open──> OPENED
PENDING/OPENED/FORWARDED ──forward──> FORWARDED
FORWARDED ──send back by Officer/Branch Head──> RETURNED
PENDING/OPENED/FORWARDED ──return for correction by DPO──> CORRECTION_REQUIRED
CORRECTION_REQUIRED ──resubmit by creator──> PENDING
PENDING/OPENED/FORWARDED ──approve by DPO──> APPROVED
PENDING/OPENED/FORWARDED ──reject by DPO──> REJECTED
APPROVED/REJECTED ──archive by Admin──> ARCHIVED
```

`REMARK` does not alter state. Finalized files cannot be approved/rejected again. A production implementation should enforce the transition matrix both in the workflow service and with a database trigger.

## 4. Authorization matrix

| Capability | Admin | DPO | Clerk | Officer | Branch Head |
|---|:---:|:---:|:---:|:---:|:---:|
| Register/upload Dak | ✓ | — | ✓ | — | own branch |
| View permitted Dak | all | assigned/office | office/status | assigned | own/forwarded |
| View protected document | ✓ | ✓ | ✓ | assigned | own/forwarded |
| Approve/reject | —* | ✓ | — | — | — |
| Forward | ✓ | ✓ | — | assigned | — |
| Add workflow remark | ✓ | ✓ | ✓** | assigned | own/forwarded |
| Send back to DPO | — | — | — | assigned | own/forwarded |
| Outward dispatch | ✓ | ✓ | ✓ | — | — |
| Audit log screen | ✓ | — | — | — | — |
| Create users | ✓ | — | — | — | — |

\* Admin does not inherit DPO signing authority.  
\** Current MVP allows a clerk to record a remark but not to alter approval state. Department policy may narrow this.

## 5. Document invariants

- Original bytes are written once using an exclusive create operation.
- Original storage names are server-generated; user-supplied names are metadata only.
- Every version has SHA-256, size, MIME, actor and timestamp metadata.
- Approval writes a new derived file and a new `documents` row.
- The approval page states that it is not a PKI signature.
- There is no hard-delete endpoint.
- Browser retrieval requires a valid session and per-Dak authorization.

For production, reinforce immutability with storage ACLs/WORM retention and a database trigger preventing update/delete of document and action rows.

## 6. Audit model

Audit actions capture:

- Dak ID and diary number (by relation)
- actor and role (role resolved from user)
- action
- previous and new status
- recipient for forwarding
- remarks/reason
- server timestamp
- source IP and user agent

A mature deployment should chain hashes or digitally seal periodic audit batches, ship logs to a separate SIEM account, and restrict DB owners from routine application administration.

## 7. Approval-signature decision

The selected MVP mode is a **controlled approval stamp**. It provides workflow evidence but is not claimed as a legal electronic/digital signature. PKI integration remains a policy and procurement gate. A future adapter should support certificate identity, certificate chain, revocation/timestamp checks, HSM/token operation, PAdES profile, and long-term validation according to the department-approved standard.

## 8. Production data/backup design

- PostgreSQL: daily full + frequent WAL/PITR, encrypted, off-host, restore drills.
- Document store: encrypted incremental backup with version retention and integrity checks.
- Recovery objectives must be approved by the department (RPO/RTO are not assumed).
- Backup administration must be separated from application roles.
- Confidentiality labels should later drive download and forwarding policies.

## 9. Known MVP boundaries

- Local prototype storage is single-process PGlite. `DATABASE_URL` enables the pooled `pg` adapter for managed PostgreSQL; credential handling, TLS termination and DB-side hardening remain deployment work.
- Login lockout is now stored in the prototype database per username/source-IP key; production should use managed PostgreSQL with a shared lockout policy.
- Controlled stamp is not PKI.
- Scanned-image OCR (English/Urdu) is integrated locally via tesseract.js with npm-installed language data; email/SMS, antivirus quarantine, Excel/PDF report export and multi-office tenancy are not yet included; restore and CSV reporting are available in the prototype.
- Device/IP evidence is best-effort behind a trusted reverse proxy.
- Durable account lockout and an approved password-recovery policy remain future production work; first-login change is implemented in the prototype, while periodic expiry and password-history reuse restrictions are intentionally disabled.

These are explicit deployment gates, not silent security assumptions.
