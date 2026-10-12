import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Cpu, Database, HardDrive, RefreshCw } from 'lucide-react';
import type { HardwareSnapshot, SystemStatus } from '../../shared/types';
import { api } from '../api';
import { bytes, ErrorNotice, humanize, Loading, Meter, time } from './ui';
import ResourcePolicy from './ResourcePolicy';
import ResidentModels from './ResidentModels';
import Retention from './Retention';
import Diagnostics from './Diagnostics';
import '../features/host/host.css';

export default function Hardware({ status }: { status?: SystemStatus }) {
  const query = useQuery({ queryKey: ['hardware'], queryFn: ({ signal }) => api<HardwareSnapshot>('/hardware', { signal }), refetchInterval: 5000 });
  const data = query.data;
  const restoration=useQuery({queryKey:['restoration'],queryFn:({signal})=>api<{pending:boolean}>('/admin/restoration',{signal})});
  const [section,setSection]=useState<'overview'|'safety'|'recovery'>('overview');
  const body=useRef<HTMLDivElement>(null);
  return <div className="host-studio">
    <header className="host-studio-intro"><div><p>Know what your host can do.</p><p className="hint">Measured resources, enforced reserves and recovery controls.</p></div><button className="icon-button" aria-label="Refresh hardware" onClick={() => { void query.refetch(); }} disabled={query.isFetching}><RefreshCw size={18} className={query.isFetching ? 'spin' : ''} /></button></header>
    {restoration.data?.pending&&<div className="host-restoration-notice" role="status"><span>This restored copy needs review before execution can resume.</span><button className="text-button" onClick={()=>{setSection('recovery');body.current?.scrollTo({top:0});}}>Review recovery</button></div>}
    <div className="host-studio-layout"><nav className="host-studio-nav" aria-label="Host sections">{([{id:'overview',label:'Overview',detail:'Current measurements'},{id:'safety',label:'Model safety',detail:'Reserves and residency'},{id:'recovery',label:'Recovery',detail:'Retention and diagnostics'}] as const).map(item=><button key={item.id} aria-label={item.label} aria-current={section===item.id?'page':undefined} aria-controls={`host-${item.id}`} onClick={()=>{setSection(item.id);body.current?.scrollTo({top:0});}}><span>{item.label}</span><small>{item.detail}</small></button>)}</nav>
      <div className="host-studio-body" ref={body} tabIndex={0} role="region" aria-label="Host section content">
        <div className="hardware-telemetry-summary">{data?<p className="sample-time">{humanize(data.platform)} / {data.architecture}{data.memoryArchitecture?` / ${data.memoryArchitecture} memory`:''}. Sampled at {time(data.sampledAt)}; refreshes every 5 seconds.</p>:!query.isError&&<Loading>Reading host telemetry…</Loading>}{query.isError&&<ErrorNotice error={query.error} retry={()=>{void query.refetch();}}/>}</div>
        <section id="host-overview" hidden={section!=='overview'} aria-label="Host overview">{data&&<HardwareMeasurements data={data} status={status}/>}</section>
        <section id="host-safety" hidden={section!=='safety'} aria-label="Model safety"><ResourcePolicy/><ResidentModels/></section>
        <section id="host-recovery" hidden={section!=='recovery'} aria-label="Host recovery"><div className="host-recovery-intro"><h3>Keep control of your data</h3><p className="muted">Review retained records and export a diagnostic report. Cleanup requires a separate preview and confirmation.</p></div><Retention/><Diagnostics/></section>
      </div>
    </div>
  </div>;
}

function HardwareMeasurements({data,status}:{data:HardwareSnapshot;status?:SystemStatus}) {
  return <>
    <section className="hardware-section"><h3><Cpu size={18} />Processor</h3><p className="hardware-name">{data.cpu.name}</p><dl className="facts-grid"><div><dt>Physical cores</dt><dd>{data.cpu.physicalCores || 'Unavailable'}</dd></div><div><dt>Logical cores</dt><dd>{data.cpu.logicalCores || 'Unavailable'}</dd></div><div><dt>Utilization</dt><dd>{data.cpu.utilization == null ? 'Unavailable' : `${data.cpu.utilization.toFixed(0)}%`}</dd></div></dl></section>
    <section className="hardware-section"><h3><Database size={18} />Memory</h3><Meter label="System memory in use" used={data.memory.totalBytes - data.memory.availableBytes} total={data.memory.totalBytes} /><p className="muted small">{bytes(data.memory.availableBytes)} available</p><Meter label="Swap / pagefile in use" used={data.memory.swapUsedBytes} total={data.memory.swapTotalBytes} /></section>
    <section className="hardware-section"><h3>Graphics</h3>{data.gpus.length ? data.gpus.map((gpu, index) => <div className="gpu-row" key={`${gpu.name}-${index}`}><p className="hardware-name">{gpu.name}</p><p className="muted small">{gpu.vendor}{gpu.memoryShared ? ' / shared system memory' : ''}{gpu.driver ? ` / driver ${gpu.driver}` : ''}</p><Meter label={gpu.memoryShared ? 'Shared GPU memory' : 'GPU memory in use'} used={gpu.usedBytes} total={gpu.totalBytes} /><dl className="facts-grid"><div><dt>Utilization</dt><dd>{gpu.utilization == null ? 'Unavailable' : `${gpu.utilization.toFixed(0)}%`}</dd></div><div><dt>Temperature</dt><dd>{gpu.temperature == null ? 'Unavailable' : `${gpu.temperature}°C`}</dd></div></dl></div>) : <p className="muted">No GPU telemetry was reported by the host.</p>}</section>
    <section className="hardware-section"><h3><HardDrive size={18} />Storage</h3>{data.storage ? <Meter label="Storage in use" used={data.storage.totalBytes - data.storage.availableBytes} total={data.storage.totalBytes} /> : <p className="muted">Storage measurements are unavailable.</p>}</section>
    {status && <section className="hardware-section"><h3>Execution boundary</h3><p>{status.sandbox.available ? 'Isolated commands available' : 'Isolated commands unavailable'}</p><p className="muted small">{status.sandbox.reason}</p><p className="muted small">Persistence: {status.database}</p></section>}
    {data.warnings.length > 0 && <div className="notice warning"><strong>Telemetry notes</strong><ul>{data.warnings.map(note => <li key={note}>{note}</li>)}</ul></div>}
  </>;
}
