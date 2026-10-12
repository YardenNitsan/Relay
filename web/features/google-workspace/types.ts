export interface WorkspaceStatus {configured:boolean;connected:boolean;readOnly:true;storage:'os-keyring'|'none';scopes:string[]}
export interface Configuration {configured:boolean;clientId:string|null;origins:string[];callbackPath:string}
export interface MailItem {id:string;snippet?:string;headers:{from?:string;to?:string;subject?:string;date?:string}}
export interface MailSearch {messages:MailItem[];limited:boolean}
export interface MailBody extends MailItem {text:string|null;bodyUnavailable:boolean;truncated:boolean}
export interface CalendarPoint {date:string|null;dateTime:string|null;timeZone:string|null}
export interface CalendarEvents {events:Array<{id:string;summary:string;description:string;location:string;status:string;start:CalendarPoint;end:CalendarPoint}>;limited:boolean}
export interface Availability {calendars:Array<{id:string;available:boolean;busy:Array<{start:string;end:string}>|null}>}
export const workspaceRoot='/integrations/google-workspace';
export function localInput(date:Date){return new Date(date.getTime()-date.getTimezoneOffset()*60_000).toISOString().slice(0,16);}
export function dateLabel(value:string){const date=new Date(value);return Number.isFinite(date.getTime())?date.toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}):'Time unavailable';}
export function pointLabel(point:CalendarPoint){return point.dateTime?dateLabel(point.dateTime):point.date?`${point.date} (all day)`:'Time unavailable';}
