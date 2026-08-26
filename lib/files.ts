import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import mammoth from 'mammoth';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync=promisify(execFile);
let officeConversionQueue:Promise<unknown>=Promise.resolve();
function queueOfficeConversion<T>(task:()=>Promise<T>):Promise<T>{
 const run=officeConversionQueue.then(task,task);
 officeConversionQueue=run.then(()=>undefined,()=>undefined);
 return run;
}

const allowed = new Set(['application/pdf', 'image/jpeg', 'image/png', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']);
const DOCX_MIME='application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function validSignature(bytes: Buffer, mime: string) {
  if (mime === 'application/pdf') return bytes.subarray(0, 5).toString('ascii') === '%PDF-';
  if (mime === 'image/png') return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  if (mime === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === DOCX_MIME) return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  return false;
}

async function convertDocxTextFallback(bytes:Buffer,output:string){
 const extracted=await mammoth.extractRawText({buffer:bytes});
 const text=(extracted.value||'').trim()||'No readable text was found in the uploaded Word document.';
 const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);
 const fontBytes=await fs.readFile(path.join(process.cwd(),'assets','fonts','DejaVuSans.ttf'));
 const font=await pdf.embedFont(fontBytes,{subset:true});
 const pageSize:[number,number]=[595.28,841.89],margin=52,fontSize=10.5,lineHeight=15,maxWidth=pageSize[0]-margin*2;
 let page=pdf.addPage(pageSize),y=pageSize[1]-margin;
 const addLine=(line:string)=>{if(y<margin+lineHeight){page=pdf.addPage(pageSize);y=pageSize[1]-margin}page.drawText(line||' ',{x:margin,y,size:fontSize,font,color:rgb(.05,.08,.07)});y-=lineHeight};
 const wrap=(line:string)=>{if(!line.trim())return [''];const words=line.replace(/\t/g,'    ').split(/\s+/);const lines:string[]=[];let current='';for(const word of words){const candidate=current?`${current} ${word}`:word;if(font.widthOfTextAtSize(candidate,fontSize)<=maxWidth)current=candidate;else{if(current)lines.push(current);if(font.widthOfTextAtSize(word,fontSize)<=maxWidth)current=word;else{let chunk='';for(const ch of word){if(font.widthOfTextAtSize(chunk+ch,fontSize)>maxWidth){lines.push(chunk);chunk=ch}else chunk+=ch}current=chunk}}}if(current)lines.push(current);return lines};
 for(const raw of text.slice(0,250000).split(/\r?\n/))for(const line of wrap(raw))addLine(line);
 const out=await pdf.save();await fs.writeFile(output,out,{flag:'wx'});return Buffer.from(out);
}

async function tryLibreOffice(sourcePath:string,output:string){
 const candidates=process.platform==='win32'?[process.env.LIBREOFFICE_PATH,'C:\\Program Files\\LibreOffice\\program\\soffice.exe','C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe','soffice.exe'].filter(Boolean) as string[]:[process.env.LIBREOFFICE_PATH,'libreoffice','soffice'].filter(Boolean) as string[];
 const tempDir=path.join(process.cwd(),'data',`docx-convert-${crypto.randomUUID()}`);await fs.mkdir(tempDir,{recursive:true});
 try{
  for(const command of candidates){
   try{
    await execFileAsync(command,['--headless','--convert-to','pdf','--outdir',tempDir,sourcePath],{timeout:120000,windowsHide:true,maxBuffer:1024*1024});
    const produced=path.join(tempDir,path.basename(sourcePath).replace(/\.docx$/i,'.pdf'));
    const pdfBytes=await fs.readFile(produced);await fs.writeFile(output,pdfBytes,{flag:'wx'});return pdfBytes;
   }catch{/* try next installed location */}
  }
  return null;
 }finally{await fs.rm(tempDir,{recursive:true,force:true})}
}

async function tryMicrosoftWord(sourcePath:string,output:string){
 if(process.platform!=='win32')return null;
 const script=`$ErrorActionPreference='Stop';$w=$null;$d=$null;try{$w=New-Object -ComObject Word.Application;$w.Visible=$false;$w.DisplayAlerts=0;$w.AutomationSecurity=3;$w.Options.UpdateLinksAtOpen=$false;$d=$w.Documents.Open($env:DPO_DOCX_SOURCE,$false,$true);$d.ExportAsFixedFormat([string]$env:DPO_PDF_OUTPUT,17,$false,0,0,1,1,0,$true,$true,1,$true,$true,$false)}finally{if($d){$d.Close($false)};if($w){$w.Quit()};[System.GC]::Collect();[System.GC]::WaitForPendingFinalizers()}`;
 try{await execFileAsync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',script],{timeout:120000,windowsHide:true,maxBuffer:1024*1024,env:{...process.env,DPO_DOCX_SOURCE:path.resolve(sourcePath),DPO_PDF_OUTPUT:path.resolve(output)}});return await fs.readFile(output)}catch{await removeStoredFile(output);return null}
}

async function convertDocxToPdf(bytes:Buffer,sourcePath:string,output:string){
 return queueOfficeConversion(async()=>{
  const office=await tryMicrosoftWord(sourcePath,output)||await tryLibreOffice(sourcePath,output);
  if(office)return office;
  if(process.env.PGLITE_MEMORY==='1')return convertDocxTextFallback(bytes,output);
  throw new Error('Exact Word conversion requires Microsoft Word or free LibreOffice. Install LibreOffice and restart the system');
 });
}

export async function saveOriginal(file: File, diary: string) {
  const isDocx=file.name.toLowerCase().endsWith('.docx')||file.type===DOCX_MIME;
  const normalizedType=isDocx?DOCX_MIME:file.type;
  if (!allowed.has(normalizedType)) throw new Error('Only PDF, DOCX, JPG and PNG files are allowed');
  if (file.size > 20 * 1024 * 1024) throw new Error('File exceeds 20 MB limit');
  if (file.size < 8) throw new Error('Uploaded file is empty or invalid');
  const bytes = Buffer.from(await file.arrayBuffer());
  if (!validSignature(bytes, normalizedType)) throw new Error('File content does not match its declared format');
  const sha = crypto.createHash('sha256').update(bytes).digest('hex');
  const ext = normalizedType === 'application/pdf' ? '.pdf' : normalizedType === 'image/png' ? '.png' : normalizedType===DOCX_MIME?'.docx':'.jpg';
  const safeDiary = diary.replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 80);
  const id=crypto.randomUUID();const stored = `DAAK-${safeDiary}-${id}-original${ext}`;
  const storedPath = path.join(process.cwd(), 'storage', 'originals', stored);
  await fs.writeFile(storedPath, bytes, { flag: 'wx' });
  const originalName=path.basename(file.name).replace(/[\r\n]/g, '').slice(0, 180) || `document${ext}`;
  let converted:undefined|{stored:string;storedPath:string;size:number;sha:string;type:string;original:string};
  if(isDocx){
   const convertedStored=`DAAK-${safeDiary}-${id}-converted.pdf`;const convertedPath=path.join(process.cwd(),'storage','derived',convertedStored);
   try{const pdfBytes=await convertDocxToPdf(bytes,storedPath,convertedPath);converted={stored:convertedStored,storedPath:convertedPath,size:pdfBytes.length,sha:crypto.createHash('sha256').update(pdfBytes).digest('hex'),type:'application/pdf',original:originalName.replace(/\.docx$/i,'')+'-converted.pdf'}}catch(error){await removeStoredFile(storedPath);await removeStoredFile(convertedPath);throw new Error(`Word to PDF conversion failed: ${error instanceof Error?error.message:'unknown error'}`)}
  }
  return {stored,storedPath,size:bytes.length,sha,type:normalizedType,original:originalName,converted};
}

export async function removeStoredFile(filePath: string) {
  try { await fs.unlink(filePath); } catch { /* best-effort orphan cleanup */ }
}

export async function saveDpoSignature(file:File,userId:number,assetType:'SIGNATURE'|'STAMP'='SIGNATURE'){
 const label=assetType==='STAMP'?'official stamp':'DPO signature';
 if(file.type!=='image/png')throw new Error(`${label} must be a transparent PNG file`);
 if(file.size<8||file.size>2*1024*1024)throw new Error(`${label} PNG must be between 8 bytes and 2 MB`);
 const bytes=Buffer.from(await file.arrayBuffer());
 if(!validSignature(bytes,'image/png'))throw new Error(`${label} file content is not a valid PNG`);
 const probe=await PDFDocument.create();
 const image=await probe.embedPng(bytes);
 if(image.width<80||image.height<30)throw new Error(`${label} image resolution is too small`);
 const stored=`dpo-${assetType.toLowerCase()}-${userId}-${crypto.randomUUID()}.png`;
 const storedPath=path.join(process.cwd(),'storage','signatures',stored);
 await fs.writeFile(storedPath,bytes,{flag:'wx'});
 return {stored,storedPath,size:bytes.length,sha:crypto.createHash('sha256').update(bytes).digest('hex')};
}

export function signatureStoragePath(name:string){return path.join(process.cwd(),'storage','signatures',path.basename(name));}

export async function approvedPdf(sourcePath:string,mime:string,output:string,info:{signaturePath?:string;stampPath?:string;remarks?:string;page:number;x:number;y:number}){
 let pdf:PDFDocument;
 if(mime==='application/pdf')pdf=await PDFDocument.load(await fs.readFile(sourcePath));
 else{
  pdf=await PDFDocument.create();const imgBytes=await fs.readFile(sourcePath);
  const img=mime==='image/png'?await pdf.embedPng(imgBytes):await pdf.embedJpg(imgBytes);
  const p=pdf.addPage([595,842]);const scale=Math.min(515/img.width,760/img.height);
  p.drawImage(img,{x:(595-img.width*scale)/2,y:(842-img.height*scale)/2,width:img.width*scale,height:img.height*scale});
 }
 const pages=pdf.getPages();
 if(!Number.isInteger(info.page)||info.page<1||info.page>pages.length)throw new Error(`Approval page must be between 1 and ${pages.length}`);
 if(!Number.isFinite(info.x)||!Number.isFinite(info.y)||info.x<0||info.x>1||info.y<0||info.y>1)throw new Error('Invalid approval position');
 if(Boolean(info.signaturePath)===Boolean(info.stampPath))throw new Error('Choose exactly one approval asset');
 const page=pages[info.page-1],{width:pw,height:ph}=page.getSize();
 const assetPath=info.signaturePath||info.stampPath!;
 const asset=await pdf.embedPng(await fs.readFile(assetPath));
 const assetSize=info.stampPath?Math.min(120,pw*.22):Math.min(145,pw*.24);
 const remarks=String(info.remarks||'').trim();
 const remarksSpace=remarks?17:0;
 const x=Math.min(Math.max(12,info.x*pw),pw-assetSize-12);
 const groupY=Math.min(Math.max(12,ph-(info.y*ph)-assetSize),ph-assetSize-12-remarksSpace);
 const ratio=Math.min(assetSize/asset.width,assetSize/asset.height);
 const aw=asset.width*ratio,ah=asset.height*ratio;
 page.drawImage(asset,{x:x+(assetSize-aw)/2,y:groupY+(assetSize-ah)/2,width:aw,height:ah});
 if(remarks){
  const font=await pdf.embedFont(StandardFonts.Helvetica);const size=8;
  const prefix='Remarks: ';let text=(prefix+remarks).replace(/[^\x20-\x7E]/g,'?');
  const maxWidth=Math.max(120,Math.min(pw-x-12,assetSize));
  while(text.length>prefix.length&&font.widthOfTextAtSize(text,size)>maxWidth)text=text.slice(0,-1);
  if(text.length<prefix.length+remarks.length)text=text.trimEnd()+'...';
  page.drawText(text,{x,y:groupY+assetSize+5,size,font,color:rgb(.08,.12,.1)});
 }
 const bytes=await pdf.save();await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,bytes,{flag:'wx'});
 return {size:bytes.length,sha:crypto.createHash('sha256').update(bytes).digest('hex'),pageCount:pages.length};
}

export function storagePath(type:string,name:string){return path.join(process.cwd(),'storage',type==='ORIGINAL'?'originals':'derived',path.basename(name));}
