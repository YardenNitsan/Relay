import {describe,expect,it} from 'vitest';
import {assistantDefinitions,assistantReadiness} from '../shared/assistants.js';

describe('observed specialist readiness, not advertised completion',()=>{
  it.each(['email','calendar'] as const)('%s requires its missing account connection and exposes no disconnected tools',id=>{
    const profile=assistantDefinitions.find(item=>item.id===id)!;
    const state=assistantReadiness(profile,{tools:[...profile.allowedTools],workspaceConnected:false,sandboxAvailable:true});
    expect(state.status).toBe('connection_required');expect(state.integrationState).toBe('not_configured');
    expect(state.tools.some(tool=>tool.startsWith('gmail_')||tool.startsWith('calendar_'))).toBe(false);
    expect(state.available).toBe(true); // Drafting from supplied content remains possible.
  });
  it.each(['email','calendar'] as const)('%s remains limited after read-only connection, with no invented writes',id=>{
    const profile=assistantDefinitions.find(item=>item.id===id)!;
    const state=assistantReadiness(profile,{tools:[...profile.allowedTools],workspaceConnected:true,sandboxAvailable:true});
    expect(state.status).toBe('limited');expect(state.integrationState).toBe('connected');
    expect(state.tools).not.toContain('gmail_send');expect(state.tools).not.toContain('calendar_create');
  });
  it('does not advertise test execution when the isolated sandbox is unavailable',()=>{
    const profile=assistantDefinitions.find(item=>item.id==='coding')!;
    const state=assistantReadiness(profile,{tools:[...profile.allowedTools],workspaceConnected:false,sandboxAvailable:false});
    expect(state.status).toBe('limited');expect(state.tools).not.toContain('terminal');
    expect(state.limitations.join(' ')).toMatch(/isolated.*unavailable/i);
  });
  it.each(assistantDefinitions)('$id never expands permission-scoped tools or treats unavailable tools as executable',profile=>{
    const state=assistantReadiness(profile,{tools:[],workspaceConnected:false,sandboxAvailable:false});
    expect(state.tools).toEqual([]);expect(state.status).not.toBe('ready');
    expect(state.id).toBe(profile.id);
  });
  it.each(['browser','computer'] as const)('%s describes absent implementation rather than asking for a nonexistent connector',id=>{
    const profile=assistantDefinitions.find(item=>item.id===id)!;
    const state=assistantReadiness(profile,{tools:[...profile.allowedTools],workspaceConnected:false,sandboxAvailable:true});
    expect(state.status).toBe('limited');expect(state.integrationState).toBe('not_implemented');
  });
});
