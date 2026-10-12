export interface ClientToken {id:string;label:string;createdAt:string|null;expiresAt:string;lastUsedAt:string|null}
export interface ClientAccess {enabled:boolean;tokens:ClientToken[];endpoints:{local:string;lan?:string;remote?:string}}
export interface IssuedToken {id:string;token:string;expiresAt:string}
