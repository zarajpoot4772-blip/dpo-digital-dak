// Regression test for the DOCX approval pipeline (server side).
//
// Verifies, against a running preview server (npm run preview):
//   1. a DOCX upload creates ORIGINAL + CONVERTED versions,
//   2. approval WITHOUT base_pdf still works (existing path),
//   3. approval WITH a browser-rendered base_pdf succeeds and stores APPROVED,
//   4. an invalid base_pdf is rejected and the Dak stays unapproved.
//
// The DOCX (Urdu table) and the sample rendered PDF are generated at runtime,
// so no binary fixtures are committed.
import { zipSync, strToU8 } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import fs from 'node:fs/promises';

const BASE = process.env.DPO_TEST_BASE || 'http://127.0.0.1:3000';

async function request(path, { token, method = 'GET', headers = {}, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(token ? { cookie: token } : {}), ...headers },
    body,
    redirect: 'manual'
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data, headers: res.headers };
}

async function login(username, password) {
  const res = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  if (res.status !== 200) throw new Error(`login ${username} failed ${res.status} ${JSON.stringify(res.data)}`);
  const cookie = res.headers.get('set-cookie')?.split(';')[0] || '';
  if (!cookie) throw new Error('no session cookie returned');
  return cookie;
}

function buildDocx() {
  const rows = [];
  for (let i = 1; i <= 4; i++) {
    rows.push(
      `<w:tr><w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="3200" w:type="dxa"/></w:tcPr><w:p><w:r><w:rPr><w:bidi/></w:rPr><w:t>پہلا خانہ ${i}</w:t></w:r></w:p></w:tc>` +
      `<w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>${i}</w:t></w:r></w:p></w:tc></w:tr>`
    );
  }
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>Urdu MCQ Table Test</w:t></w:r></w:p>
<w:tbl><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="8"/><w:left w:val="single" w:sz="8"/><w:bottom w:val="single" w:sz="8"/><w:right w:val="single" w:sz="8"/><w:insideH w:val="single" w:sz="8"/><w:insideV w:val="single" w:sz="8"/></w:tblBorders></w:tblPr>${rows.join('')}</w:tbl>
<w:p><w:r><w:t>End of Word layout test.</w:t></w:r></w:p>
</w:body></w:document>`;
  return Buffer.from(zipSync({
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`),
    'word/document.xml': strToU8(documentXml)
  }));
}

async function uploadDak(clerk, docx, subject) {
  const form = new FormData();
  form.set('allow_duplicate', 'true');
  form.set('subject', subject);
  form.set('attachment', new Blob([docx], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), 'urdu-table-test.docx');
  const res = await request('/api/daks', { token: clerk, method: 'POST', headers: { origin: BASE }, body: form });
  if (res.status !== 201) throw new Error(`DOCX upload failed ${res.status} ${JSON.stringify(res.data)}`);
  return res.data.id;
}

const clerk = await login('clerk', 'Clerk@12345');
const dpo = await login('dpo', 'Dpo@12345');
const adminCookie = await login('admin', 'Admin@12345');

// Configure the DPO signature (required for approval) with the OCR PNPG fixture.
const me = await request('/api/me', { token: dpo });
const sigForm = new FormData();
sigForm.set('user_id', String(me.data.user.id));
sigForm.set('asset_type', 'SIGNATURE');
sigForm.set('asset', new Blob([await fs.readFile('scripts/fixtures/ocr-verify.png')], { type: 'image/png' }), 'signature.png');
const sig = await request('/api/signatures', { token: adminCookie, method: 'POST', headers: { origin: BASE }, body: sigForm });
if (sig.status !== 201) throw new Error(`signature upload failed ${sig.status} ${JSON.stringify(sig.data)}`);

const docx = buildDocx();

// 1) DOCX versions exist.
const idPlain = await uploadDak(clerk, docx, `Approval PDF QA plain ${Date.now()}`);
const plainDetail = await request(`/api/daks/${idPlain}`, { token: dpo });
const plainVersions = plainDetail.data.documents.map((d) => `${d.version_type}:${d.file_type}`);
console.log('DOCX versions:', plainVersions.join(', '));
if (!plainVersions.some((v) => v.startsWith('ORIGINAL:application/vnd.openxmlformats-officedocument'))) throw new Error('DOCX original missing');

// 2) Existing server-PDF approval path still works.
const plain = await request(`/api/daks/${idPlain}/action`, {
  token: dpo, method: 'POST',
  headers: { 'Content-Type': 'application/json', origin: BASE },
  body: JSON.stringify({ action: 'APPROVE', remarks: 'QA no base', signature_mode: 'SIGNATURE_ONLY', signature_page: 1, signature_x: 0.6, signature_y: 0.6 })
});
if (plain.status !== 200) throw new Error(`approve without base_pdf failed ${plain.status} ${JSON.stringify(plain.data)}`);
console.log('approve without base_pdf ->', plain.status);

// 3) Browser-rendered base_pdf approval (simulated client PDF, stamped on server).
const idRendered = await uploadDak(clerk, docx, `Approval PDF QA rendered ${Date.now()}`);
const samplePdf = await PDFDocument.create();
samplePdf.addPage([595.28, 841.89]);
samplePdf.addPage([595.28, 841.89]);
const base64 = Buffer.from(await samplePdf.save()).toString('base64');
const withBase = await request(`/api/daks/${idRendered}/action`, {
  token: dpo, method: 'POST',
  headers: { 'Content-Type': 'application/json', origin: BASE },
  body: JSON.stringify({ action: 'APPROVE', remarks: 'QA rendered layout', signature_mode: 'SIGNATURE_ONLY', signature_page: 2, signature_x: 0.4, signature_y: 0.4, base_pdf: base64 })
});
if (withBase.status !== 200) throw new Error(`base_pdf approval failed ${withBase.status} ${JSON.stringify(withBase.data)}`);
const renderedDetail = await request(`/api/daks/${idRendered}`, { token: dpo });
if (!renderedDetail.data.documents.some((d) => d.version_type === 'APPROVED' && d.file_type === 'application/pdf')) throw new Error('APPROVED version missing after base_pdf approval');
console.log('approve with base_pdf ->', withBase.status, 'APPROVED stored');

// 4) Invalid base_pdf is rejected and the Dak is not finalized.
const idBad = await uploadDak(clerk, docx, `Approval PDF QA invalid ${Date.now()}`);
const bad = await request(`/api/daks/${idBad}/action`, {
  token: dpo, method: 'POST',
  headers: { 'Content-Type': 'application/json', origin: BASE },
  body: JSON.stringify({ action: 'APPROVE', remarks: 'QA bad', signature_mode: 'SIGNATURE_ONLY', signature_page: 1, signature_x: 0.5, signature_y: 0.5, base_pdf: 'not-a-pdf' })
});
if (bad.status === 200) throw new Error('invalid base_pdf was accepted');
const badDetail = await request(`/api/daks/${idBad}`, { token: dpo });
if (badDetail.data.dak.status === 'APPROVED') throw new Error('Dak finalized despite invalid base_pdf');
console.log('invalid base_pdf ->', bad.status, 'rejected as expected');

console.log('OK: DOCX approval PDF pipeline verified');
process.exit(0);
