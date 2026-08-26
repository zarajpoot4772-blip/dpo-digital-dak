import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const API_BASE = 'https://developers.hostinger.com';
const ARCHIVE_NAME = 'dpo-dak-deploy.zip';
const ROOT_DIRECTORY = 'dpo-dak-system';

const apiKey = process.env.HOSTINGER_API_KEY?.trim();
const targetDomain = process.env.HOSTINGER_DOMAIN?.trim();
if (!apiKey) throw new Error('HOSTINGER_API_KEY GitHub secret is not configured.');
if (!targetDomain) throw new Error('HOSTINGER_DOMAIN is not configured.');

async function hostingerRequest(endpoint, options = {}) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) {
    throw new Error(`Hostinger API ${response.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  }
  return data;
}

function shouldCopy(relativePath) {
  if (!relativePath) return true;
  const normalized = relativePath.replaceAll('\\', '/');
  const excluded = [
    '.git', '.next', 'node_modules', 'data', 'tmp', 'log',
    'storage/originals', 'storage/derived', 'storage/signatures',
    'dpo-dak-deploy.zip'
  ];
  return !excluded.some((name) => normalized === name || normalized.startsWith(`${name}/`));
}

async function makeArchive() {
  const staging = await mkdtemp(path.join(tmpdir(), 'dpo-dak-hostinger-'));
  const appRoot = path.join(staging, ROOT_DIRECTORY);
  try {
    await cp(process.cwd(), appRoot, {
      recursive: true,
      filter: (source) => shouldCopy(path.relative(process.cwd(), source))
    });
    const archivePath = path.join(staging, ARCHIVE_NAME);
    await execFileAsync('zip', ['-qr', archivePath, ROOT_DIRECTORY], { cwd: staging, maxBuffer: 1024 * 1024 });
    return { staging, archivePath };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

async function uploadArchive(archivePath, username) {
  const upload = await hostingerRequest('/api/hosting/v1/files/upload-urls', {
    method: 'POST',
    body: JSON.stringify({ username, domain: targetDomain })
  });
  if (!upload?.url || !upload?.auth_key || !upload?.rest_auth_key) {
    throw new Error('Hostinger did not return upload credentials.');
  }

  const archive = await readFile(archivePath);
  const uploadEndpoint = `${upload.url.replace(/\/$/, '')}/${ARCHIVE_NAME}?override=true`;
  const authHeaders = {
    'X-Auth': upload.auth_key,
    'X-Auth-Rest': upload.rest_auth_key,
    'Tus-Resumable': '1.0.0',
    'Upload-Length': String(archive.byteLength),
    'Upload-Offset': '0'
  };
  const create = await fetch(uploadEndpoint, { method: 'POST', headers: authHeaders });
  if (!create.ok && create.status !== 201) {
    throw new Error(`Hostinger file upload could not be created (${create.status}).`);
  }
  const location = create.headers.get('location') || uploadEndpoint;
  const send = await fetch(location, {
    method: 'PATCH',
    headers: { ...authHeaders, 'Content-Type': 'application/offset+octet-stream' },
    body: archive
  });
  if (!send.ok && send.status !== 204) {
    throw new Error(`Hostinger file upload failed (${send.status}).`);
  }
  console.log(`Uploaded ${ARCHIVE_NAME} (${archive.byteLength} bytes).`);
}

async function startBuild(username) {
  const build = await hostingerRequest(`/api/hosting/v1/accounts/${encodeURIComponent(username)}/websites/${encodeURIComponent(targetDomain)}/nodejs/builds`, {
    method: 'POST',
    body: JSON.stringify({
      node_version: 22,
      app_type: 'next',
      root_directory: ROOT_DIRECTORY,
      output_directory: '.next',
      build_script: 'build',
      package_manager: 'npm',
      source_type: 'archive',
      source_options: { archive_path: ARCHIVE_NAME }
    })
  });
  if (!build?.uuid) throw new Error('Hostinger did not return a build ID.');
  console.log(`Hostinger build started: ${build.uuid}`);
  return build.uuid;
}

async function waitForBuild(username, uuid) {
  let fromLine = 0;
  for (let attempt = 0; attempt < 180; attempt += 1) {
    try {
      const logs = await hostingerRequest(`/api/hosting/v1/accounts/${encodeURIComponent(username)}/websites/${encodeURIComponent(targetDomain)}/nodejs/builds/${encodeURIComponent(uuid)}/logs?from_line=${fromLine}`);
      const lines = logs?.lines || logs?.data || [];
      if (Array.isArray(lines) && lines.length) {
        for (const line of lines) console.log(typeof line === 'string' ? line : JSON.stringify(line));
        fromLine += lines.length;
      }
    } catch (error) {
      console.log(`Build log read retry: ${error.message}`);
    }

    const builds = await hostingerRequest(`/api/hosting/v1/accounts/${encodeURIComponent(username)}/websites/${encodeURIComponent(targetDomain)}/nodejs/builds?per_page=50`);
    const list = Array.isArray(builds) ? builds : (builds?.data || []);
    const current = list.find((item) => item.uuid === uuid);
    const state = current?.state || 'running';
    console.log(`Build status: ${state}`);
    if (state === 'completed') return;
    if (state === 'failed') throw new Error('Hostinger build failed. Open the deployment build log for details.');
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }
  throw new Error('Hostinger build timed out after 30 minutes.');
}

const { staging, archivePath } = await makeArchive();
try {
  const websites = await hostingerRequest('/api/hosting/v1/websites?website_types=nodejs&per_page=100');
  const list = Array.isArray(websites) ? websites : (websites?.data || []);
  const site = list.find((item) => String(item.domain || '').toLowerCase() === targetDomain.toLowerCase());
  if (!site?.username) throw new Error(`Node.js website ${targetDomain} was not found in the Hostinger account.`);
  console.log(`Using Hostinger website ${targetDomain}.`);
  await uploadArchive(archivePath, site.username);
  const buildId = await startBuild(site.username);
  await waitForBuild(site.username, buildId);
  console.log('Hostinger deployment completed successfully.');
} finally {
  await rm(staging, { recursive: true, force: true });
}
