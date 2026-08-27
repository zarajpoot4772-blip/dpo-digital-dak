import { PGlite } from '@electric-sql/pglite';
import bcrypt from 'bcryptjs';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fs from 'fs/promises';
import path from 'path';
import { dataRoot, snapshotPath, storageRoot, usingExternalRuntimeRoot } from './runtime-paths';

type DB = PGlite;
declare global { var __dpoDb: Promise<DB> | undefined; var __dpoPersist: Promise<void> | undefined; }

async function writeSnapshot(db:DB){
 if(process.env.PGLITE_MEMORY==='1')return;
 const dump=await db.dumpDataDir();
 const temp=`${snapshotPath}.tmp`;
 await fs.writeFile(temp,Buffer.from(await dump.arrayBuffer()));
 await fs.rm(snapshotPath,{force:true});
 await fs.rename(temp,snapshotPath);
}

export async function persistDb(){
 if(process.env.PGLITE_MEMORY==='1')return;
 const db=await getDb();
 global.__dpoPersist=(global.__dpoPersist||Promise.resolve()).then(()=>writeSnapshot(db));
 await global.__dpoPersist;
}

async function makeSamplePdf(filePath:string){
 const pdf=await PDFDocument.create(); const page=pdf.addPage([595,842]); const font=await pdf.embedFont(StandardFonts.Helvetica); const bold=await pdf.embedFont(StandardFonts.HelveticaBold);
 page.drawText('OFFICE OF THE DISTRICT POLICE OFFICER',{x:70,y:770,size:16,font:bold,color:rgb(0.05,.2,.15)});
 page.drawText('Official Dak — Demonstration Document',{x:70,y:730,size:13,font:bold});
 page.drawText('Letter No: SO(Admin)/2026/441',{x:70,y:690,size:11,font});
 page.drawText('Subject: Monthly law and order coordination meeting',{x:70,y:665,size:11,font});
 page.drawText('The monthly coordination meeting is proposed for 22 August 2026.',{x:70,y:620,size:11,font});
 page.drawText('Submitted for kind approval and further directions, please.',{x:70,y:598,size:11,font});
 page.drawText('This document was generated as sample data for the local prototype.',{x:70,y:120,size:9,font,color:rgb(.4,.4,.4)});
 await fs.writeFile(filePath, await pdf.save());
}

async function migrateLegacyRuntimeData(){
 if(!usingExternalRuntimeRoot)return;
 const legacySnapshot=path.join(process.cwd(),'data','pglite-data.tar');
 try{await fs.access(snapshotPath)}catch{
  try{await fs.copyFile(legacySnapshot,snapshotPath)}catch{/* first deployment may have no legacy snapshot */}
 }
 for(const folder of ['originals','derived','signatures']){
  const source=path.join(process.cwd(),'storage',folder);
  const target=path.join(storageRoot,folder);
  try{
   const entries=await fs.readdir(source);
   for(const name of entries){
    if(name==='.gitkeep')continue;
    const destination=path.join(target,path.basename(name));
    try{await fs.access(destination)}catch{try{await fs.copyFile(path.join(source,name),destination)}catch{/* preserve an existing runtime file */}}
   }
  }catch{/* no legacy storage is normal on a new deployment */}
 }
}

async function init(){
 await fs.mkdir(dataRoot,{recursive:true});
 await fs.mkdir(path.join(storageRoot,'originals'),{recursive:true});
 await fs.mkdir(path.join(storageRoot,'derived'),{recursive:true});
 await fs.mkdir(path.join(storageRoot,'signatures'),{recursive:true});
 await migrateLegacyRuntimeData();
 // Windows-compatible persistence: PostgreSQL runs in memory and is atomically
 // snapshotted to the runtime data directory after durable workflow mutations.
 let loadDataDir:Blob|undefined;
 if(process.env.PGLITE_MEMORY!=='1'){
  try{loadDataDir=new Blob([await fs.readFile(snapshotPath)]);}catch(error:any){if(error?.code!=='ENOENT')throw error;}
 }
 const db=loadDataDir?new PGlite({loadDataDir}):new PGlite();
 await db.exec(`
 CREATE TABLE IF NOT EXISTS users(id SERIAL PRIMARY KEY,name TEXT NOT NULL,username TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('ADMIN','DPO','CLERK','OFFICER','BRANCH_HEAD')),department TEXT,branch TEXT,active BOOLEAN NOT NULL DEFAULT true,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
 CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),expires_at TIMESTAMPTZ NOT NULL,ip TEXT,user_agent TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
 CREATE TABLE IF NOT EXISTS branches(id SERIAL PRIMARY KEY,name TEXT UNIQUE NOT NULL,code TEXT UNIQUE NOT NULL,department TEXT NOT NULL DEFAULT 'DPO Office',head_user_id INTEGER REFERENCES users(id),active BOOLEAN NOT NULL DEFAULT true,created_by INTEGER REFERENCES users(id),created_at TIMESTAMPTZ NOT NULL DEFAULT now());
 CREATE TABLE IF NOT EXISTS daks(id SERIAL PRIMARY KEY,diary_number TEXT UNIQUE NOT NULL,diary_date DATE NOT NULL,received_date DATE NOT NULL,received_time TIME NOT NULL,subject TEXT NOT NULL,sender TEXT NOT NULL,letter_number TEXT,letter_date DATE,department TEXT,branch TEXT,priority TEXT NOT NULL DEFAULT 'NORMAL',confidentiality TEXT NOT NULL DEFAULT 'OFFICIAL',status TEXT NOT NULL DEFAULT 'PENDING',assigned_to INTEGER REFERENCES users(id),created_by INTEGER NOT NULL REFERENCES users(id),remarks TEXT,opened_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),archived_at TIMESTAMPTZ);
 CREATE TABLE IF NOT EXISTS documents(id SERIAL PRIMARY KEY,dak_id INTEGER NOT NULL REFERENCES daks(id),version_type TEXT NOT NULL CHECK(version_type IN ('ORIGINAL','CONVERTED','APPROVED','REJECTED_COPY')),original_filename TEXT NOT NULL,stored_filename TEXT UNIQUE NOT NULL,file_type TEXT NOT NULL,file_size INTEGER NOT NULL,sha256 TEXT NOT NULL,uploaded_by INTEGER NOT NULL REFERENCES users(id),uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),immutable BOOLEAN NOT NULL DEFAULT true);
 CREATE TABLE IF NOT EXISTS actions(id SERIAL PRIMARY KEY,dak_id INTEGER NOT NULL REFERENCES daks(id),user_id INTEGER NOT NULL REFERENCES users(id),action TEXT NOT NULL,remarks TEXT,previous_status TEXT,new_status TEXT,to_user_id INTEGER REFERENCES users(id),ip TEXT,user_agent TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
 CREATE TABLE IF NOT EXISTS signatures(id SERIAL PRIMARY KEY,dak_id INTEGER NOT NULL REFERENCES daks(id),signed_by INTEGER NOT NULL REFERENCES users(id),signature_method TEXT NOT NULL,signed_document INTEGER REFERENCES documents(id),signed_at TIMESTAMPTZ NOT NULL DEFAULT now(),reference_number TEXT UNIQUE NOT NULL);
 CREATE TABLE IF NOT EXISTS user_signatures(id SERIAL PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),asset_type TEXT NOT NULL DEFAULT 'SIGNATURE' CHECK(asset_type IN ('SIGNATURE','STAMP')),stored_filename TEXT UNIQUE NOT NULL,file_size INTEGER NOT NULL,sha256 TEXT NOT NULL,uploaded_by INTEGER NOT NULL REFERENCES users(id),active BOOLEAN NOT NULL DEFAULT true,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
 CREATE TABLE IF NOT EXISTS notifications(id SERIAL PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),dak_id INTEGER REFERENCES daks(id),message TEXT NOT NULL,is_read BOOLEAN NOT NULL DEFAULT false,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
 CREATE INDEX IF NOT EXISTS idx_daks_status ON daks(status); CREATE INDEX IF NOT EXISTS idx_daks_assigned ON daks(assigned_to); CREATE INDEX IF NOT EXISTS idx_actions_dak ON actions(dak_id,created_at); CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id,is_read);
 `);
 // Idempotent local-schema migration for workspaces created before Branch Head support.
 await db.exec(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check; ALTER TABLE users ADD CONSTRAINT users_role_check CHECK(role IN ('ADMIN','DPO','CLERK','OFFICER','BRANCH_HEAD')); ALTER TABLE user_signatures ADD COLUMN IF NOT EXISTS asset_type TEXT NOT NULL DEFAULT 'SIGNATURE'; ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_version_type_check; ALTER TABLE documents ADD CONSTRAINT documents_version_type_check CHECK(version_type IN ('ORIGINAL','CONVERTED','APPROVED','REJECTED_COPY')); DROP INDEX IF EXISTS idx_user_signatures_active; CREATE UNIQUE INDEX IF NOT EXISTS idx_user_signature_asset_active ON user_signatures(user_id,asset_type) WHERE active=true;`);
 const count=await db.query<{count:string}>('SELECT count(*)::text count FROM users');
 if(Number(count.rows[0].count)===0){
  const users=[['System Administrator','admin','Admin@12345','ADMIN','DPO Office','IT'],['District Police Officer','dpo','Dpo@12345','DPO','Police','DPO Office'],['Dak Clerk','clerk','Clerk@12345','CLERK','DPO Office','Dak Branch'],['SP Investigation','sp.inv','Officer@12345','OFFICER','Police','Investigation'],['Branch Head Operations','head.ops','Branch@12345','BRANCH_HEAD','DPO Office','Operations Branch']];
  for(const u of users) await db.query('INSERT INTO users(name,username,password_hash,role,department,branch) VALUES($1,$2,$3,$4,$5,$6)',[u[0],u[1],await bcrypt.hash(u[2],12),u[3],u[4],u[5]]);
  await db.exec(`INSERT INTO branches(name,code,department,head_user_id,created_by) SELECT 'Operations Branch','OPS','DPO Office',id,1 FROM users WHERE username='head.ops' ON CONFLICT(code) DO NOTHING;`);
  const sample=path.join(storageRoot,'originals','DAAK-1254-original.pdf'); await makeSamplePdf(sample); const stat=await fs.stat(sample); const crypto=await import('crypto'); const sha=crypto.createHash('sha256').update(await fs.readFile(sample)).digest('hex');
  const d=await db.query<{id:number}>(`INSERT INTO daks(diary_number,diary_date,received_date,received_time,subject,sender,letter_number,letter_date,department,branch,priority,confidentiality,status,assigned_to,created_by,remarks) VALUES('1254/2026','2026-08-18','2026-08-18','09:35','Monthly law and order coordination meeting','Home Department Punjab','SO(Admin)/2026/441','2026-08-16','Home Department','DPO Office','URGENT','OFFICIAL','PENDING',2,3,'For kind perusal and orders') RETURNING id`);
  await db.query(`INSERT INTO documents(dak_id,version_type,original_filename,stored_filename,file_type,file_size,sha256,uploaded_by) VALUES($1,'ORIGINAL','coordination-letter.pdf','DAAK-1254-original.pdf','application/pdf',$2,$3,3)`,[d.rows[0].id,stat.size,sha]);
  await db.query(`INSERT INTO actions(dak_id,user_id,action,remarks,previous_status,new_status) VALUES($1,3,'CREATED','Dak entered and original document uploaded',NULL,'PENDING')`,[d.rows[0].id]);
  await db.query(`INSERT INTO notifications(user_id,dak_id,message) VALUES(2,$1,'New urgent Dak 1254/2026 is pending for your review.')`,[d.rows[0].id]);
 }
 if(process.env.PGLITE_MEMORY==='1'){
  await db.exec(`INSERT INTO sessions(id,user_id,expires_at,ip,user_agent)
   SELECT 'demo-dpo-session',id,now()+interval '30 days','preview','Arena preview' FROM users WHERE username='dpo' ON CONFLICT(id) DO UPDATE SET expires_at=excluded.expires_at;
   INSERT INTO sessions(id,user_id,expires_at,ip,user_agent)
   SELECT 'demo-clerk-session',id,now()+interval '30 days','preview','Arena preview' FROM users WHERE username='clerk' ON CONFLICT(id) DO UPDATE SET expires_at=excluded.expires_at;
   INSERT INTO sessions(id,user_id,expires_at,ip,user_agent)
   SELECT 'demo-admin-session',id,now()+interval '30 days','preview','Arena preview' FROM users WHERE username='admin' ON CONFLICT(id) DO UPDATE SET expires_at=excluded.expires_at;
   INSERT INTO sessions(id,user_id,expires_at,ip,user_agent)
   SELECT 'demo-officer-session',id,now()+interval '30 days','preview','Arena preview' FROM users WHERE username='sp.inv' ON CONFLICT(id) DO UPDATE SET expires_at=excluded.expires_at;
   INSERT INTO sessions(id,user_id,expires_at,ip,user_agent)
   SELECT 'demo-branch-session',id,now()+interval '30 days','preview','Arena preview' FROM users WHERE username='head.ops' ON CONFLICT(id) DO UPDATE SET expires_at=excluded.expires_at;`);
 }
 if(process.env.PGLITE_MEMORY!=='1')await writeSnapshot(db);
 return db;
}
export function getDb(){ if(!global.__dpoDb) global.__dpoDb=init(); return global.__dpoDb; }

export async function closeDb(){
 const current=global.__dpoDb;
 if(!current)return;
 try{const db=await current;await db.close()}finally{global.__dpoDb=undefined;global.__dpoPersist=undefined}
}
