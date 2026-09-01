# DPO Digital Dak — Production Deployment Guide

This guide takes the system from the local PGlite prototype to a hardened
office deployment on managed PostgreSQL. Read it together with the
"Production deployment gate" in [`README.md`](README.md) and
[`ARCHITECTURE.md`](ARCHITECTURE.md).

Template files live in [`deploy/`](deploy/): systemd unit, Nginx site and the
environment file example.

---

## 1. Prerequisites

| Component | Requirement |
|---|---|
| Server | Hardened Ubuntu/Debian Linux on the office LAN, patched, time synced (NTP) |
| Node.js | 20 LTS or newer |
| PostgreSQL | 16 or newer (same host or a dedicated DB host) |
| Reverse proxy | Nginx with a department-issued or LAN-CA TLS certificate |
| Storage | Dedicated volume for `/var/lib/dpo-dak` (encryption at rest where policy requires) |
| Access | SSH key-only login, firewall allowing only 22 (admin), 80/443 (users), 5432 (DB host only) |

## 2. PostgreSQL provisioning (least privilege)

```sql
-- run as postgres superuser, once
CREATE ROLE dpo_app LOGIN PASSWORD 'strong-random-password';
CREATE DATABASE dpo_dak OWNER dpo_app;
-- dpo_app owns its schema; do NOT give it SUPERUSER/CREATEDB.
```

In `pg_hba.conf`, force scram-sha-256 for the app host:

```
hostssl  dpo_dak  dpo_app  10.0.0.0/8  scram-sha-256
```

The application creates and migrates its own schema on first start; no manual
DDL is needed. For full production durability enable WAL archiving/PITR at the
cluster level (`archive_command`, `wal_level=replica`).

## 3. Application install

```bash
sudo useradd --system --home /var/lib/dpo-dak --shell /usr/sbin/nologin dpo
sudo mkdir -p /var/lib/dpo-dak && sudo chown dpo:dpo /var/lib/dpo-dak

sudo -u dpo git clone <your-repo-url> /opt/dpo-digital-dak
cd /opt/dpo-digital-dak
sudo -u dpo npm ci
sudo -u dpo npm run build        # typecheck runs in CI; build validates again
```

Create `/etc/dpo-dak.env` from [`deploy/dpo-dak.env.example`](deploy/dpo-dak.env.example),
then:

```bash
sudo cp deploy/dpo-dak.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now dpo-dak
```

First start on an empty database requires `INITIAL_ADMIN_PASSWORD` (see the
env example). The admin account is created in forced-password-change state:
log in once, set the real password, then remove the variable from the env
file. Production does **not** seed demo accounts or sample Dak data.

Confirm: `curl -s http://127.0.0.1:3000/api/health` → `{"status":"ok"}`.

## 4. HTTPS reverse proxy

Install [`deploy/nginx-dpo-dak.conf`](deploy/nginx-dpo-dak.conf) as shown in
its header comments, adjust `server_name` and certificate paths, then
`sudo nginx -t && sudo systemctl reload nginx`.

Production builds send strict security headers themselves
(Content-Security-Policy, HSTS, nosniff, frame and referrer controls). The
proxy provides TLS, the real client IP (`X-Real-IP`/`X-Forwarded-For`) used
in the audit trail, and the 25 MB upload limit.

## 5. Backups and restore drills

### Daily automated backups

Two equivalent mechanisms:

1. **Built-in (recommended):** the app writes `backups/automatic-YYYY-MM-DD.zip`
   on the first dashboard request each day. In PostgreSQL mode this ZIP
   carries the private document files (originals, derived, signatures) —
   the database itself is covered by (2).
2. **Database archives:** schedule with cron on the DB host:

   ```cron
   30 2 * * *  postgres  pg_dump -Fc -f /var/backups/dpo_dak/$(date +\%F).dump dpo_dak
   ```

   plus an explicit logical backup from the app host if you want a single
   portable archive containing both rows and document files:

   ```bash
   sudo -u dpo env $(cat /etc/dpo-dak.env | xargs) npm run pg:backup --prefix /opt/dpo-digital-dak
   ```

Keep archives encrypted, off-host, and on rotation (e.g. 7 daily, 4 weekly,
12 monthly). Copy the whole `/var/lib/dpo-dak` off-host as well.

### Restore drill (test quarterly, before go-live)

The drill below was executed and verified against a live PostgreSQL-mode
deployment during development:

```bash
cd /opt/dpo-digital-dak
sudo -u dpo env $(cat /etc/dpo-dak.env | xargs) npm run pg:backup      # 1. fresh archive
# 2. simulate data loss (test only!): DROP SCHEMA public CASCADE; CREATE SCHEMA public;
sudo systemctl restart dpo-dak                                          # 3. app recreates empty schema
curl -s http://127.0.0.1:3000/api/health                                #    wait for {"status":"ok"}
sudo -u dpo env $(cat /etc/dpo-dak.env | xargs) npm run pg:restore -- backups/pg-<stamp>.zip
```

`pg:restore` verifies the SHA-256 sidecar, replays every table inside one
transaction, realigns serial sequences, compares row counts with the manifest,
and copies storage files back (existing files are kept unless
`--force-storage` is passed). For engine-level archives use
`pg_restore -d dpo_dak --clean --if-exists <file>.dump`.

Record the drill (date, operator, result) in the office logbook — a backup
that has never been restored is not a backup.

## 6. Monitoring and logs

| What | How |
|---|---|
| Service health | `systemctl status dpo-dak`, HTTP check on `/api/health` from your monitor |
| App logs | `journalctl -u dpo-dak -f` (startup prints the active database engine) |
| Access/errors | `/var/log/nginx/dpo-dak-*.log` |
| Audit trail | In-app Admin audit screen; export to SIEM per department policy |
| DB | `pg_stat_activity`, WAL archiving alerts, disk usage of the data volume |

## 7. Go-live checklist

| # | Gate | Status |
|---|---|---|
| 1 | PostgreSQL 16+, least-privilege `dpo_app` role, scram-sha-256, TLS to DB where applicable | ☐ |
| 2 | HTTPS via reverse proxy with department/LAN-CA certificate; HTTP redirects to HTTPS | ☐ |
| 3 | `INITIAL_ADMIN_PASSWORD` used once, then removed from `/etc/dpo-dak.env` | ☐ |
| 4 | All pilot accounts created by Admin; users changed first-login passwords; 2FA enabled for Admin/DPO | ☐ |
| 5 | Demo accounts/seed data confirmed absent (production seeds none) | ☐ |
| 6 | `/var/lib/dpo-dak` on dedicated (encrypted where required) volume with OS ACLs | ☐ |
| 7 | Daily document ZIP + database archives scheduled, encrypted, off-host | ☐ |
| 8 | Restore drill executed successfully and recorded | ☐ |
| 9 | Firewall/SSH hardening, NTP sync, fail2ban or equivalent on SSH | ☐ |
| 10 | Backup retention, DR objectives (RPO/RTO) approved by the department | ☐ |
| 11 | Users trained: workflow, signatures are workflow evidence, **not PKI legal signatures** | ☐ |
| 12 | Malware scanning / upload quarantine decision documented | ☐ |
| 13 | Audit log export/SIEM and retention/classification policy confirmed | ☐ |
| 14 | UAT sign-off by DPO office | ☐ |

## 8. Redeployments and upgrades

```bash
cd /opt/dpo-digital-dak
sudo -u dpo git pull
sudo -u dpo npm ci && sudo -u dpo npm run build
sudo systemctl restart dpo-dak
```

Application data never lives in the deploy directory (`DPO_RUNTIME_ROOT`), and
idempotent schema migration runs on start. Take a fresh `pg:backup` before
every upgrade.
