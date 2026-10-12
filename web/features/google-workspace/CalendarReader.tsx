import type {Availability,CalendarEvents} from './types';
import {dateLabel,pointLabel} from './types';

interface Props {start:string;end:string;onStart:(value:string)=>void;onEnd:(value:string)=>void;busy:string;events:CalendarEvents|null;availability:Availability|null;onRead:(kind:'events'|'freebusy')=>void}
export function CalendarReader({start,end,onStart,onEnd,busy,events,availability,onRead}:Props){
  return <section aria-label="Read primary calendar" className="google-studio-calendar google-studio-scroll">
    <header><h3>Your primary calendar</h3><p>Choose a time window, then read events or check availability.</p></header>
    <form className="google-studio-form" onSubmit={event=>{event.preventDefault();onRead('events');}}>
      <div className="google-studio-dates"><label>From<input type="datetime-local" value={start} onChange={event=>onStart(event.target.value)} required disabled={!!busy}/></label><label>Until<input type="datetime-local" value={end} onChange={event=>onEnd(event.target.value)} required disabled={!!busy}/></label></div>
      <p className="hint">Your primary calendar, up to 20 events within 31 days. Times use {Intl.DateTimeFormat().resolvedOptions().timeZone||'your browser time zone'}.</p>
      <div className="button-row"><button className="button primary" disabled={!!busy}>{busy==='events'?'Reading…':'Read events'}</button><button className="button" type="button" disabled={!!busy} onClick={()=>onRead('freebusy')}>{busy==='freebusy'?'Checking…':'Check availability'}</button></div>
    </form>
    {events&&<div className="google-studio-events" aria-label="Calendar results"><p role="status">{events.events.length?`${events.events.length} events returned.`:'No events returned in this window.'}{events.limited?' More events exist; narrow the time window.':''}</p>{events.events.map((event,index)=><article key={`${event.id}-${index}`}><h4 dir="auto">{event.summary||'Untitled event'}</h4><p>{pointLabel(event.start)} — {pointLabel(event.end)}</p>{event.location&&<p className="hint" dir="auto">{event.location}</p>}{event.description&&<p className="google-studio-description" dir="auto">{event.description}</p>}</article>)}</div>}
    {availability&&<div className="google-studio-availability" aria-label="Calendar availability">{availability.calendars.map(item=><div key={item.id}>{!item.available||!item.busy?<p role="status">Availability could not be verified.</p>:item.busy.length?<><p role="status">{item.busy.length} busy periods returned.</p><ul>{item.busy.map((period,index)=><li key={index}>{dateLabel(period.start)} — {dateLabel(period.end)}</li>)}</ul></>:<p role="status">No busy periods were returned for this calendar in the selected window.</p>}</div>)}</div>}
  </section>;
}
