export type AppRole = "ADMINISTRATOR" | "PLANNER" | "TECHNICIAN" | "PRODUCTION";
export const roles: AppRole[];
export const roleLabels: Record<AppRole, string>;
export type ResourceRights = Record<'GET'|'POST'|'PUT'|'DELETE',boolean>;
export interface RolePermissions {pages:Record<string,boolean>;resources:Record<string,ResourceRights>;history:{edit:boolean;delete:boolean};}
export type Permissions = Record<AppRole,RolePermissions>;
export const permissionResources:string[];
export const permissionPages:string[];
export const permissionMethods:('GET'|'POST'|'PUT'|'DELETE')[];
export const immutableResources:string[];
export function defaultPermissions():Permissions;
export function isHistory(row?: Record<string, unknown>): boolean;
export function canAccess(role: AppRole | undefined, page: string, policies?:Permissions): boolean;
export function canLookup(role: AppRole | undefined, resource: string, policies?:Permissions): boolean;
export function canPerform(
  role: AppRole | undefined,
  resource: string,
  method: string,
  row?: Record<string, unknown>,
  policies?:Permissions,
): boolean;
