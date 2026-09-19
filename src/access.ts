import {canAccess as access,canPerform as perform,defaultPermissions,type AppRole,type Permissions} from '../shared/permissions.mjs';
let current:Permissions=defaultPermissions();
export function applyPermissions(permissions?:Permissions){current=permissions||defaultPermissions();}
export function canAccess(role:AppRole|undefined,page:string){return (page==='users'&&role==='PLANNER')||access(role,page==='factory-layout'?'overview':page,current)||(page==='spare-parts'&&perform(role,'stock-transactions','POST',undefined,current));}
export function canPerform(role:AppRole|undefined,resource:string,method:string,row?:Record<string,unknown>){return perform(role,resource,method,row,current);}
