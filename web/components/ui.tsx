import { useEffect, useRef, type ReactNode } from 'react';
import { Check, Circle, CircleAlert, LoaderCircle, X } from 'lucide-react';
import type { TaskStatus } from '../../shared/types';
import {ModalGuardContext,useModalGuardController} from './modal-guard';

export function Modal({ title, children, onClose, wide = false, className = '', fallbackFocusId, initialFocus }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean; className?: string; fallbackFocusId?: string; initialFocus?:string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const guard=useModalGuardController();
  const requestClose=()=>guard.request(onClose);
  // Capture before descendants with autoFocus mount. Native showModal otherwise
  // remembers the already-focused dialog input instead of the invoking control.
  const returnFocus = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    if(initialFocus)dialog?.querySelector<HTMLElement>(initialFocus)?.focus();
    return () => {
      if (dialog?.open) dialog.close();
      const origin = returnFocus.current;
      if (origin?.isConnected && origin !== document.body && origin.getClientRects().length && !origin.closest('dialog:not([open])')) origin.focus();
      else {
        const fallback = fallbackFocusId ? document.getElementById(fallbackFocusId) : null;
        if (fallback?.getClientRects().length) { fallback.focus(); return; }
        const visibleNavigation = Array.from(document.querySelectorAll<HTMLButtonElement>('.mobile-navigation, .command-trigger')).find(element => element.getClientRects().length > 0);
        (visibleNavigation ?? document.querySelector<HTMLButtonElement>('.brand'))?.focus();
      }
    };
  }, []);
  return <ModalGuardContext.Provider value={guard}><dialog ref={ref} className={`modal ${wide ? 'modal-wide' : ''} ${className}`} aria-label={title} onCancel={event => { event.preventDefault(); event.stopPropagation(); requestClose(); }} onClick={event => {
    if (event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) requestClose();
  }}>
    <header className="modal-heading"><h2>{title}</h2><button className="icon-button" aria-label={`Close ${title}`} onClick={requestClose}><X size={19} /></button></header>
    <div className="modal-content">{guard.blocked&&<p className="notice" role="status">Wait for the current operation to finish before leaving this view.</p>}{children}</div>
  </dialog>{guard.pending&&<Modal title="Unsaved changes" onClose={guard.keep} initialFocus="[data-keep-editing]"><p>Your edits to {guard.pending.labels.join(', ')} have not been saved.</p><p>Discard them and leave this view?</p><div className="workspace-file-actions"><button className="button primary" data-keep-editing onClick={guard.keep}>Keep editing</button><button className="button danger-button" onClick={guard.discard}>Discard edits</button></div></Modal>}</ModalGuardContext.Provider>;
}

export function Empty({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return <div className="empty-state">{icon && <div className="empty-icon">{icon}</div>}<h3>{title}</h3>{children && <div className="muted">{children}</div>}</div>;
}

export function ErrorNotice({ error, retry }: { error: unknown; retry?: () => void }) {
  return <div className="inline-error" role="alert"><CircleAlert size={17} /><div>{error instanceof Error ? error.message : String(error)}{retry && <button className="text-button" onClick={retry}>Try again</button>}</div></div>;
}

export function Loading({ children = 'Loading…' }: { children?: ReactNode }) {
  return <p className="loading" role="status"><LoaderCircle size={17} className="spin" />{children}</p>;
}

export function ConversationSkeleton() {
  return <div className="conversation-skeleton" role="status" aria-label="Opening conversation"><span className="sr-only">Opening conversation…</span><div aria-hidden="true"><span className="skeleton-label" /><span className="skeleton-line skeleton-title" /><span className="skeleton-line" /><div className="skeleton-receipt" /><span className="skeleton-label" /><span className="skeleton-line" /><span className="skeleton-line" /><span className="skeleton-line skeleton-short" /></div></div>;
}

export const isActive = (status: TaskStatus) => ['created', 'analyzing', 'planning', 'executing', 'verifying', 'replanning', 'waiting_for_approval'].includes(status);
export const humanize = (value: string) => value.toLowerCase().replaceAll('_', ' ').replace(/^\w/, char => char.toUpperCase());
export function Status({ status }: { status: string }) {
  const tone = ['completed', 'passed', 'ready', 'available'].includes(status) ? 'success' : ['failed', 'error', 'denied'].includes(status) ? 'danger' : ['waiting_for_approval', 'paused', 'offline', 'waiting_for_user'].includes(status) ? 'warning' : 'neutral';
  const Icon = tone === 'success' ? Check : tone === 'danger' ? CircleAlert : Circle;
  return <span className={`status status-${tone}`}><Icon size={12} />{humanize(status)}</span>;
}

export function bytes(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'Unavailable';
  const unit = value >= 1024 ** 3 ? 'GB' : value >= 1024 ** 2 ? 'MB' : 'KB';
  const divisor = unit === 'GB' ? 1024 ** 3 : unit === 'MB' ? 1024 ** 2 : 1024;
  return `${(value / divisor).toLocaleString(undefined, { maximumFractionDigits: 1 })} ${unit}`;
}

export const time = (value: string) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
export const shortDate = (value: string) => new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric' });

export function Meter({ label, used, total }: { label: string; used: number | null; total: number | null }) {
  const percentage = total && used != null ? Math.max(0, Math.min(100, used / total * 100)) : null;
  const semantics = percentage == null
    ? { 'aria-hidden': true as const }
    : { role: 'meter', 'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': percentage, 'aria-valuetext': `${Math.round(percentage)} percent used` };
  return <div className="meter-block"><div className="split"><span>{label}</span><span className="muted">{used == null ? 'Unavailable' : bytes(used)}{total != null ? ` / ${bytes(total)}` : ''}</span></div><div className="meter" {...semantics}><span className={percentage != null && percentage > 85 ? 'pressure' : ''} style={{ width: `${percentage ?? 0}%` }} /></div></div>;
}
