import {canAccess as access,canPerform as perform,defaultPermissions,type AppRole,type Permissions} from '../shared/permissions.mjs';
let current:Permissions=defaultPermissions();
export function applyPermissions(permissions?:Permissions){current=permissions||defaultPermissions();}
export function canAccess(role:AppRole|undefined,page:string){return access(role,page,current);}
export function canPerform(role:AppRole|undefined,resource:string,method:string,row?:Record<string,unknown>){return perform(role,resource,method,row,current);}
