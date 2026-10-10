/** Provisioning is an explicit owner command, restricted to a local engine. */
export function localDockerEndpoint(endpoint:string,environmentHost?:string,environmentBuilder?:string):string {
  if(environmentBuilder&&environmentBuilder!=='default')throw new Error('BUILDX_BUILDER must select the local default engine builder');
  if(environmentHost&&environmentHost!==endpoint)throw new Error('DOCKER_HOST differs from the inspected context; clear it before provisioning');
  if(!/^unix:\/\/\/[^\s\0]+$/.test(endpoint)&&!/^npipe:\/\/\/\/\.\/pipe\/[a-zA-Z0-9_.-]+$/.test(endpoint))throw new Error('Development image provisioning requires a local Unix socket or Windows named pipe');
  return endpoint;
}
