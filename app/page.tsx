'use client';
import { FormEvent, useEffect, useState } from 'react';
export default function Login(){
 const [username,setU]=useState('dpo'); const [password,setP]=useState('Dpo@12345'); const [error,setE]=useState(''); const [busy,setB]=useState(false);
 useEffect(()=>{localStorage.removeItem('dpo_preview_token')},[]);
 async function submit(e:FormEvent){e.preventDefault();setB(true);setE('');
  try{
   const r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});
   const text=await r.text();const j=text?JSON.parse(text):{};setB(false);
   if(!r.ok){setE(j.error||'Login failed');return}
   if(j.preview_token){localStorage.setItem('dpo_preview_token',j.preview_token);window.location.assign(`/portal?auth=${encodeURIComponent(j.preview_token)}`)}
   else window.location.assign('/portal');
  }catch{setB(false);setE('Connection error. Please try again.')}
 }
 return <main className="login-page"><section className="login-brand"><div className="seal">PK</div><p>GOVERNMENT OF PUNJAB</p><h1>DPO Digital Dak<br/>& File Management System</h1><p className="muted-light">Secure • Traceable • Accountable</p><div className="security-note">🔒 Authorized office personnel only. All access and actions are logged.</div></section><section className="login-panel"><form className="login-card" onSubmit={submit}><div className="mobile-seal">PK</div><p className="eyebrow">SECURE ACCESS</p><h2>Sign in to your account</h2><p className="sub">Enter your official credentials to continue.</p>{error&&<div className="alert error">{error}</div>}<label>Username<input value={username} onChange={e=>setU(e.target.value)} autoComplete="username" required/></label><label>Password<input type="password" value={password} onChange={e=>setP(e.target.value)} autoComplete="current-password" required/></label><button className="primary wide" disabled={busy}>{busy?'Verifying…':'Sign in securely →'}</button><div className="demo-box"><b>Prototype accounts</b><span>DPO: dpo / Dpo@12345</span><span>Clerk: clerk / Clerk@12345</span><span>Admin: admin / Admin@12345</span><span>Branch Head: head.ops / Branch@12345</span></div><small>By signing in, you acknowledge that activity is monitored and audited.</small></form></section></main>
}
