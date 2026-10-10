import {describe,expect,it} from 'vitest';
import {localDockerEndpoint} from '../scripts/development-image-policy';

describe('explicit development image provisioning boundary',()=>{
  it('accepts only local Docker transports',()=>{
    expect(localDockerEndpoint('unix:///var/run/docker.sock')).toBe('unix:///var/run/docker.sock');
    expect(localDockerEndpoint('npipe:////./pipe/dockerDesktopLinuxEngine')).toBe('npipe:////./pipe/dockerDesktopLinuxEngine');
    for(const endpoint of ['tcp://example.com:2376','ssh://owner@server','npipe:////server/pipe/docker','unix://server/socket','--host=tcp://host',''])expect(()=>localDockerEndpoint(endpoint)).toThrow(/local/i);
  });
  it('rejects ambiguous environment transport before provisioning',()=>{
    expect(()=>localDockerEndpoint('unix:///var/run/docker.sock','tcp://remote:2375')).toThrow(/DOCKER_HOST/);
    expect(localDockerEndpoint('unix:///var/run/docker.sock','unix:///var/run/docker.sock')).toBe('unix:///var/run/docker.sock');
  });
  it('rejects an inherited remote Buildx builder even when Docker itself is local',()=>{
    expect(()=>localDockerEndpoint('unix:///var/run/docker.sock',undefined,'cloud-team')).toThrow(/BUILDX_BUILDER/);
    expect(localDockerEndpoint('unix:///var/run/docker.sock',undefined,'default')).toBe('unix:///var/run/docker.sock');
  });
});
