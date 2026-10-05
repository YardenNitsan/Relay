import { homedir, hostname, platform, arch } from 'node:os';
import { join } from 'node:path';

export interface HostPlatform {
  readonly os:'windows'|'linux'|'macos';
  readonly architecture:string;
  readonly name:string;
  dataDirectory():string;
  secretBackend():string;
  readonly executionBoundary:string;
}
abstract class BaseHost {
  readonly architecture=arch();readonly name=hostname();
  readonly executionBoundary='Optional Linux container broker; native host execution is not enabled';
}
export class WindowsHost extends BaseHost implements HostPlatform {
  readonly os='windows';dataDirectory(){return join(process.env.LOCALAPPDATA??join(homedir(),'AppData','Local'),'Relay');}
  secretBackend(){return 'Windows Credential Manager';}
}
export class LinuxHost extends BaseHost implements HostPlatform {
  readonly os='linux';dataDirectory(){return join(process.env.XDG_DATA_HOME??join(homedir(),'.local','share'),'relay');}
  secretBackend(){return 'Secret Service (session-only credentials if unavailable)';}
}
export class MacOSHost extends BaseHost implements HostPlatform {
  readonly os='macos';dataDirectory(){return join(homedir(),'Library','Application Support','Relay');}
  secretBackend(){return 'macOS Keychain';}
}
export function hostPlatform(os=platform()):HostPlatform {
  if(os==='win32')return new WindowsHost();if(os==='linux')return new LinuxHost();if(os==='darwin')return new MacOSHost();
  throw new Error(`Unsupported host platform: ${os}`);
}
