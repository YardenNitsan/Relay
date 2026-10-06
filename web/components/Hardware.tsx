import { useQuery } from '@tanstack/react-query';
import { Cpu, Database, HardDrive, RefreshCw } from 'lucide-react';
import type { HardwareSnapshot, SystemStatus } from '../../shared/types';
import { api } from '../api';
import { bytes, ErrorNotice, humanize, Loading, Meter, time } from './ui';
import ResourcePolicy from './ResourcePolicy';
import ResidentModels from './ResidentModels';

export default function Hardware({ status }: { status?: SystemStatus }) {
  const query = useQuery({ queryKey: ['hardware'], queryFn: ({ signal }) => api<HardwareSnapshot>('/hardware', { signal }), refetchInterval: 5000 });
  const data = query.data;
  if (!data) return query.isError ? <ErrorNotice error={query.error} retry={() => { void query.refetch(); }} /> : <Loading>Reading host telemetry…</Loading>;
  return <><div className="split section-intro"><div><p>Your machine, measured.</p><p className="muted">{humanize(data.platform)} / {data.architecture}{data.memoryArchitecture ? ` / ${data.memoryArchitecture} memory` : ''}</p></div><button className="icon-button" aria-label="Refresh hardware" onClick={() => { void query.refetch(); }} disabled={query.isFetching}><RefreshCw size={17} className={query.isFetching ? 'spin' : ''} /></button></div><p className="sample-time">Sampled at {time(data.sampledAt)}. Refreshes every 5 seconds while open.</p>
    <ResourcePolicy /><ResidentModels />
    <section className="hardware-section"><h3><Cpu size={18} />Processor</h3><p className="hardware-name">{data.cpu.name}</p><dl className="facts-grid"><div><dt>Physical cores</dt><dd>{data.cpu.physicalCores || 'Unavailable'}</dd></div><div><dt>Logical cores</dt><dd>{data.cpu.logicalCores || 'Unavailable'}</dd></div><div><dt>Utilization</dt><dd>{data.cpu.utilization == null ? 'Unavailable' : `${data.cpu.utilization.toFixed(0)}%`}</dd></div></dl></section>
    <section className="hardware-section"><h3><Database size={18} />Memory</h3><Meter label="System memory in use" used={data.memory.totalBytes - data.memory.availableBytes} total={data.memory.totalBytes} /><p className="muted small">{bytes(data.memory.availableBytes)} available</p><Meter label="Swap / pagefile in use" used={data.memory.swapUsedBytes} total={data.memory.swapTotalBytes} /></section>
    <section className="hardware-section"><h3>Graphics</h3>{data.gpus.length ? data.gpus.map((gpu, index) => <div className="gpu-row" key={`${gpu.name}-${index}`}><p className="hardware-name">{gpu.name}</p><p className="muted small">{gpu.vendor}{gpu.memoryShared ? ' / shared system memory' : ''}{gpu.driver ? ` / driver ${gpu.driver}` : ''}</p><Meter label={gpu.memoryShared ? 'Shared GPU memory' : 'GPU memory in use'} used={gpu.usedBytes} total={gpu.totalBytes} /><dl className="facts-grid"><div><dt>Utilization</dt><dd>{gpu.utilization == null ? 'Unavailable' : `${gpu.utilization.toFixed(0)}%`}</dd></div><div><dt>Temperature</dt><dd>{gpu.temperature == null ? 'Unavailable' : `${gpu.temperature}°C`}</dd></div></dl></div>) : <p className="muted">No GPU telemetry was reported by the host.</p>}</section>
    <section className="hardware-section"><h3><HardDrive size={18} />Storage</h3>{data.storage ? <Meter label="Storage in use" used={data.storage.totalBytes - data.storage.availableBytes} total={data.storage.totalBytes} /> : <p className="muted">Storage measurements are unavailable.</p>}</section>
    {status && <section className="hardware-section"><h3>Execution boundary</h3><p>{status.sandbox.available ? 'Isolated commands available' : 'Isolated commands unavailable'}</p><p className="muted small">{status.sandbox.reason}</p><p className="muted small">Persistence: {status.database}</p></section>}
    {data.warnings.length > 0 && <div className="notice warning"><strong>Telemetry notes</strong><ul>{data.warnings.map(note => <li key={note}>{note}</li>)}</ul></div>}{query.isError && <ErrorNotice error={query.error} />}
  </>;
}
