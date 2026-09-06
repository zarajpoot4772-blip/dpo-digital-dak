#!/usr/bin/env node
// Logical backup for PostgreSQL deployments (DATABASE_URL mode).
// Writes a timestamped ZIP containing every table's rows plus the private
// storage folders. Pure Node: no pg_dump binary required, so it also works
// from a jump host against a managed remote database.
//
// Usage:  DATABASE_URL=... npm run pg:backup [-- --out /path/to/dir]
//
// Restore with scripts/pg-restore.mjs. PGlite (non-DATABASE_URL) installs
// keep using the in-app admin backup, which already embeds the engine
// snapshot.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { strToU8, zipSync } from 'fflate';

const MAX_FILES = 5000;
const MAX_UNCOMPRESSED_BYTES = 500 * 1024 * 1024;
const STORAGE_FOLDERS = ['originals', 'derived', 'signatures'];

// FK-safe order: parents first, referencing tables after.
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

function cleanName(name) {
  return path.basename(name).replace(/[\\/\r\n]/g, '');
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    console.error('DATABASE_URL is required (this tool backs up PostgreSQL deployments only)');
    process.exit(1);
  }
  const outDirArg = process.argv.indexOf('--out');
  const outDir = outDirArg > -1 ? path.resolve(process.argv[outDirArg + 1]) : path.join(process.cwd(), 'backups');
  await fs.mkdir(outDir, { recursive: true });

  const pgModule = await import('pg');
  const Pool = pgModule.Pool || pgModule.default?.Pool;
  const types = pgModule.types || pgModule.default?.types;
  // Preserve DATE columns exactly as PostgreSQL returns them: parsing them
  // into JS Dates would shift the calendar day when serialized back from a
  // non-UTC timezone.
  const keepDatesAsStrings = { getTypeParser: (oid, format) => (oid === 1082 ? (v) => v : types.getTypeParser(oid, format)) };
  const pool = new Pool({ connectionString: databaseUrl, max: 2, types: keepDatesAsStrings });

  const entries = {};
  const rowCounts = {};
  for (const table of TABLE_ORDER) {
    const exists = await pool.query("SELECT to_regclass($1) IS NOT NULL AS present", [`public.${table}`]);
    if (!exists.rows[0].present) continue;
    const columns = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [table]);
    const names = columns.rows.map((c) => c.column_name);
    const selection = names.map((n) => `"${n}"`).join(',');
    const result = await pool.query(`SELECT ${selection} FROM "${table}"`);
    rowCounts[table] = result.rows.length;
    entries[`data/${table}.json`] = strToU8(JSON.stringify({
      table,
      columns: names,
      rows: result.rows.map((row) => names.map((n) => normalize(row[n])))
    }));
  }

  const storageRoot = resolveStorageRoot();
  let fileCount = Object.keys(entries).length;
  let totalBytes = Object.values(entries).reduce((sum, b) => sum + b.byteLength, 0);
  for (const folder of STORAGE_FOLDERS) {
    let items = [];
    try { items = await fs.readdir(path.join(storageRoot, folder), { withFileTypes: true }); } catch { continue; }
    for (const item of items) {
      if (!item.isFile() || item.name === '.gitkeep') continue;
      const name = cleanName(item.name);
      if (!name || name === '.' || name === '..') continue;
      if (++fileCount > MAX_FILES) throw new Error('Backup contains too many files');
      const bytes = new Uint8Array(await fs.readFile(path.join(storageRoot, folder, name)));
      totalBytes += bytes.byteLength;
      if (totalBytes > MAX_UNCOMPRESSED_BYTES) throw new Error('Backup is larger than the 500 MB limit');
      entries[`storage/${folder}/${name}`] = bytes;
    }
  }

  const parsed = new URL(databaseUrl);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  entries['manifest.json'] = strToU8(JSON.stringify({
    format: 'dpo-pg-backup',
    format_version: 1,
    created_at: new Date().toISOString(),
    database: { host: parsed.hostname, port: parsed.port || 5432, name: decodeURIComponent(parsed.pathname.slice(1)) },
    row_counts: rowCounts,
    note: 'PostgreSQL logical backup. Restore with: npm run pg:restore -- <file.zip>'
  }, null, 2));

  const zip = Buffer.from(zipSync(entries, { level: 6 }));
  const target = path.join(outDir, `pg-${stamp}.zip`);
  await fs.writeFile(target, zip, { flag: 'wx' });
  const sha256 = crypto.createHash('sha256').update(zip).digest('hex');
  await fs.writeFile(`${target}.sha256`, `${sha256}  ${path.basename(target)}\n`, { flag: 'wx' });

  console.log(`Backup written: ${target}`);
  console.log(`Size: ${(zip.byteLength / 1024).toFixed(1)} KB | SHA-256: ${sha256.slice(0, 16)}…`);
  console.log('Table rows:', Object.entries(rowCounts).map(([t, n]) => `${t}=${n}`).join(', '));
  await pool.end();
}

// JSON-safe value preparation (Dates -> ISO strings keep full fidelity for
// timestamptz; DATE columns already arrive as plain strings).
function normalize(value) {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (value !== null && typeof value === 'object' && typeof value.toByteArray === 'function') return Buffer.from(value.toByteArray());
  return value;
}

main().catch((error) => { console.error('BACKUP_FAILED:', error.message); process.exit(1); });
