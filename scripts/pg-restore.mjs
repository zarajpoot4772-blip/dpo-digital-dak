#!/usr/bin/env node
// Restore for backups created by scripts/pg-backup.mjs (PostgreSQL mode).
// Replays every table inside one transaction (TRUNCATE ... RESTART IDENTITY
// CASCADE first), realigns serial sequences, then copies private storage
// files back. The database schema must already exist: on a wiped server,
// start the application once so init() recreates it, then run this tool.
//
// Usage:  DATABASE_URL=... npm run pg:restore -- backups/pg-<stamp>.zip [--force-storage]
//
// Safety: the restore is destructive for current database rows. Keep the
// automatic admin ZIP backups / pg:backup archives before restoring.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { strFromU8, unzipSync } from 'fflate';

const MAX_FILES = 5000;
const MAX_UNCOMPRESSED_BYTES = 500 * 1024 * 1024;
const STORAGE_FOLDERS = ['originals', 'derived', 'signatures'];
const INSERT_CHUNK = 100;

// Same FK-safe order as the backup script.
const TABLE_ORDER = [
  'users', 'login_throttle', 'sessions', 'mfa_challenges', 'branches', 'daks',
  'documents', 'actions', 'file_notes', 'dispatches', 'signatures',
  'user_signatures', 'notifications'
];

function resolveStorageRoot() {
  if (process.env.DPO_RUNTIME_ROOT?.trim()) return path.resolve(process.env.DPO_RUNTIME_ROOT.trim(), 'storage');
  if (process.env.NODE_ENV === 'production') return path.join(process.env.HOME || os.homedir(), '.dpo-digital-dak-runtime', 'storage');
  return path.resolve(process.cwd(), 'storage');
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) { console.error('DATABASE_URL is required'); process.exit(1); }
  const zipArg = process.argv.find((a) => a.endsWith('.zip'));
  if (!zipArg) { console.error('Usage: npm run pg:restore -- backups/pg-<stamp>.zip [--force-storage]'); process.exit(1); }
  const forceStorage = process.argv.includes('--force-storage');
  const zipPath = path.resolve(zipArg);
  const bytes = new Uint8Array(await fs.readFile(zipPath));

  const expectedFile = path.basename(zipPath);
  try {
    const expected = (await fs.readFile(`${zipPath}.sha256`)).toString().trim().split(/\s+/)[0];
    const actual = crypto.createHash('sha256').update(bytes).digest('hex');
    if (expected !== actual) { console.error('SHA-256 mismatch: the archive is corrupted or was modified'); process.exit(1); }
    console.log(`Integrity verified (${expected.slice(0, 16)}…)`);
  } catch { console.warn('No .sha256 sidecar found; continuing without integrity verification'); }

  const files = unzipSync(bytes);
  if (Object.keys(files).length > MAX_FILES) { console.error('Backup contains too many files'); process.exit(1); }
  let total = 0;
  for (const name of Object.keys(files)) total += files[name].byteLength;
  if (total > MAX_UNCOMPRESSED_BYTES) { console.error('Backup expands beyond the 500 MB limit'); process.exit(1); }
  const manifest = JSON.parse(strFromU8(files['manifest.json']));
  if (manifest?.format !== 'dpo-pg-backup' || manifest?.format_version !== 1) { console.error('Not a DPO PostgreSQL backup archive'); process.exit(1); }

  const pgModule = await import('pg');
  const Pool = pgModule.Pool || pgModule.default?.Pool;
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const schema = await pool.query("SELECT to_regclass('public.users') IS NOT NULL AS present");
  if (!schema.rows[0].present) {
    console.error('Schema missing: start the application once against this database to create it, then re-run the restore.');
    await pool.end(); process.exit(1);
  }

  const before = await countRows(pool);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const present = TABLE_ORDER.filter((t) => files[`data/${t}.json`]);
    await client.query(`TRUNCATE ${present.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`);
    for (const table of present) {
      const payload = JSON.parse(strFromU8(files[`data/${table}.json`]));
      const cols = payload.columns.map((c) => `"${c}"`).join(',');
      for (let i = 0; i < payload.rows.length; i += INSERT_CHUNK) {
        const chunk = payload.rows.slice(i, i + INSERT_CHUNK);
        const params = [];
        const tuples = chunk.map((row) => {
          const placeholders = row.map((value) => {
            params.push(value === undefined ? null : value);
            return `$${params.length}`;
          });
          return `(${placeholders.join(',')})`;
        });
        await client.query(`INSERT INTO "${table}"(${cols}) VALUES ${tuples.join(',')} ON CONFLICT DO NOTHING`, params);
      }
    }
    // Realign every serial/identity sequence with the restored data.
    const serials = await client.query(
      `SELECT table_name,column_name FROM information_schema.columns
       WHERE table_schema='public' AND column_default LIKE 'nextval(%'`);
    for (const s of serials.rows) {
      await client.query(
        `SELECT setval(pg_get_serial_sequence($1,$2), COALESCE((SELECT MAX("${s.column_name}") FROM "${s.table_name}"),0)+1, false)`,
        [s.table_name, s.column_name]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('RESTORE_FAILED (transaction rolled back):', error.message);
    process.exitCode = 1;
  } finally {
    client.release();
  }

  const after = await countRows(pool);
  console.log('Rows before:', summarize(before));
  console.log('Rows after :', summarize(after));
  if (!process.exitCode) {
    for (const [table, count] of Object.entries(after)) {
      const expectedCount = manifest.row_counts?.[table];
      if (expectedCount !== undefined && expectedCount !== count) {
        console.warn(`WARNING: ${table} restored ${count} rows, backup manifest expected ${expectedCount}`);
      }
    }
  }

  // Storage files: default keeps existing files untouched; --force-storage overwrites.
  const storageRoot = resolveStorageRoot();
  let copied = 0, skipped = 0;
  for (const name of Object.keys(files)) {
    if (!/^storage\/(originals|derived|signatures)\/[^/]+$/.test(name)) continue;
    const [, folder, leaf] = name.split('/');
    const target = path.join(storageRoot, folder, path.basename(leaf));
    await fs.mkdir(path.dirname(target), { recursive: true });
    try {
      if (forceStorage) await fs.rm(target, { force: true });
      await fs.writeFile(target, files[name], { flag: 'wx' });
      copied += 1;
    } catch (error) {
      if (error?.code === 'EEXIST') { skipped += 1; continue; }
      throw error;
    }
  }
  console.log(`Storage: ${copied} file(s) restored, ${skipped} already present (use --force-storage to overwrite)`);
  await pool.end();
  if (!process.exitCode) console.log('RESTORE COMPLETE');
}

async function countRows(pool) {
  const counts = {};
  for (const table of TABLE_ORDER) {
    const exists = await pool.query("SELECT to_regclass($1) IS NOT NULL AS present", [`public.${table}`]);
    if (!exists.rows[0].present) continue;
    const r = await pool.query(`SELECT count(*)::int n FROM "${table}"`);
    counts[table] = r.rows[0].n;
  }
  return counts;
}

function summarize(counts) {
  return Object.entries(counts).filter(([, n]) => n > 0).map(([t, n]) => `${t}=${n}`).join(', ') || 'empty';
}

main().catch((error) => { console.error('RESTORE_FAILED:', error.message); process.exit(1); });
