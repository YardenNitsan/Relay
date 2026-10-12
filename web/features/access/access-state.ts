import type {RemoteSetupState} from '../../components/RemoteSetup';
export interface RemoteState extends RemoteSetupState {enabled:boolean;configured?:boolean;listening?:boolean;publicOrigin:string|null;hostName:string;gatewayPort:number;authentication:string;requiresSetup:boolean;localAccessIndependent:boolean}
export interface BrowserSession {id:string;userId:string;remote:boolean;userAgent:string;createdAt:string;lastActiveAt:string;expiresAt:string}
export interface ActiveTask {id:string;userId:string;status:string;callsUsed:number}
