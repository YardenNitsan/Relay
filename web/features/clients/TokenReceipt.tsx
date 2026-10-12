import {useState,type RefObject} from 'react';
import {Check,Copy,Eye,EyeOff,KeyRound} from 'lucide-react';
import {shortDate} from '../../components/ui';
import type {IssuedToken} from './types';

export function TokenReceipt({issued,busy,copied,headingRef,onCopy,onHide}:{issued:IssuedToken;busy:boolean;copied:boolean;headingRef:RefObject<HTMLHeadingElement|null>;onCopy:()=>void;onHide:()=>void}){
  const [revealed,setRevealed]=useState(false);
  return <section className="clients-receipt" aria-label="New client token">
    <KeyRound size={28} aria-hidden="true"/><h3 ref={headingRef} tabIndex={-1}>Save this token now</h3>
    <p>Keep it in your application’s credential storage. It expires {shortDate(issued.expiresAt)}.</p>
    <p className="clients-secret-warning">Once hidden or this panel is closed, this token cannot be shown again. You can still revoke its grant and create a replacement.</p>
    <label>New API token<input value={issued.token} readOnly type={revealed?'text':'password'} autoComplete="off" spellCheck={false} onFocus={event=>event.currentTarget.select()}/></label>
    <button type="button" className="text-button" disabled={busy} onClick={()=>setRevealed(value=>!value)}>{revealed?<EyeOff size={17} aria-hidden="true"/>:<Eye size={17} aria-hidden="true"/>}{revealed?'Hide token':'Show token'}</button>
    <div className="clients-actions"><button className="button primary" disabled={busy} onClick={onCopy}>{copied?<Check size={17} aria-hidden="true"/>:<Copy size={17} aria-hidden="true"/>}{copied?'Copied':'Copy token'}</button><button className="button" disabled={busy} onClick={onHide}>Done, hide token</button></div>
  </section>;
}
