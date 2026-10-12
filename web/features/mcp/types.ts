export interface ToolContract {name:string;description:string;inputSchema:Record<string,unknown>;outputSchema?:Record<string,unknown>;schemaHash:string}
export interface McpServer {id:string;name:string;url:string;enabled:boolean;tools:ToolContract[]}
export interface McpConfiguration {servers:McpServer[];protocol:string;transport:string}
