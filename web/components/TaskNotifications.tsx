import {Bell} from 'lucide-react';
import type {NotificationControls} from '../useTaskNotifications';

export default function TaskNotifications({controls}:{controls:NotificationControls}) {
  return <section aria-label="Task notifications"><h3><Bell size={17}/>Task notifications</h3><p className="muted">Get a private completion alert when a task you followed in this tab finishes. Keep Relay open; notifications while the browser is closed are not supported.</p><p className="hint">System alerts appear when this tab is in the background. They contain no prompt, answer or file details. Some phone browsers support in-app alerts only.</p>
    {!controls.supported?<p className="notice">System notifications are unavailable in this browser or connection. Completion alerts still appear in Relay.</p>:<><button className="button" disabled={controls.pending} onClick={()=>{if(controls.enabled)controls.disable();else void controls.enable();}}>{controls.pending?'Waiting for browser permission':controls.enabled?'Turn off system notifications':'Enable system notifications'}</button>{controls.permission==='denied'&&<p className="hint">Blocked by your browser. Change this site's notification permission in browser settings to enable system alerts.</p>}</>}
  </section>;
}
