export const roles = ["ADMINISTRATOR", "PLANNER", "TECHNICIAN", "PRODUCTION"];
export const roleLabels = {
  ADMINISTRATOR: "Administrator",
  PLANNER: "Planner",
  TECHNICIAN: "Technician",
  PRODUCTION: "Production (Operator)",
};
export const permissionResources = ['assets','maintenance-plans','work-orders','spare-parts','stock-transactions','calibration-history'];
export const permissionPages = ['overview','reports','settings'];
export const permissionMethods = ['GET','POST','PUT','DELETE'];
export const immutableResources = ['stock-transactions','calibration-history'];
export function isHistory(row) {
  const key=Object.keys(row||{}).find(k=>k.toLowerCase()==='statuscode');
  return ['COMPLETED','CLOSED','CANCELLED'].includes(String(row?.[key]||'').toUpperCase());
}
export function defaultPermissions() {
  return Object.fromEntries(roles.map(role=>[role,{
    pages:{overview:role!=='PRODUCTION',reports:['ADMINISTRATOR','PLANNER'].includes(role),settings:role!=='PRODUCTION'},
    resources:Object.fromEntries(permissionResources.map(resource=>{
      const master=['assets','maintenance-plans','spare-parts'].includes(resource);
      return [resource,{
        GET:role!=='PRODUCTION'||['assets','work-orders','stock-transactions'].includes(resource),
        POST:role==='ADMINISTRATOR'||role==='PLANNER'||(role==='TECHNICIAN'&&!master)||(role==='PRODUCTION'&&['work-orders','stock-transactions'].includes(resource)),
        PUT:!immutableResources.includes(resource)&&(role==='ADMINISTRATOR'||role==='PLANNER'||(role==='TECHNICIAN'&&!master)),
        DELETE:!immutableResources.includes(resource)&&(role==='ADMINISTRATOR'||(role==='PLANNER'&&resource==='work-orders'))
      }];
    })),
    history:{edit:role==='ADMINISTRATOR',delete:role==='ADMINISTRATOR'}
  }]));
}
const defaults=defaultPermissions();
export function canAccess(role,page,policies=defaults) {
  if(!roles.includes(role))return false;
  if(page==='vendors'||page==='pm-history')return canAccess(role,'maintenance-plans',policies);
  if(page==='users')return role==='ADMINISTRATOR';
  const rules=policies?.[role];
  if(permissionResources.includes(page))return rules?.resources?.[page]?.GET===true;
  if(page==='reports')return rules?.pages?.reports===true && ['assets','work-orders','maintenance-plans','spare-parts'].every(r=>rules?.resources?.[r]?.GET===true);
  return permissionPages.includes(page)&&rules?.pages?.[page]===true;
}
export function canLookup(role,resource,policies=defaults) {
  const rights=policies?.[role]?.resources;
  if(!rights||!roles.includes(role))return false;
  if(resource==='spare-parts'||resource==='work-orders')return rights['stock-transactions']?.POST===true;
  if(resource==='assets')return ['work-orders','maintenance-plans','calibration-history'].some(r=>rights[r]?.POST===true);
  if(resource==='maintenance-plans')return rights['calibration-history']?.POST===true;
  return false;
}
export function canPerform(role,resource,method,row,policies=defaults) {
  if(!roles.includes(role)||!permissionResources.includes(resource)||!permissionMethods.includes(method))return false;
  if(method==='GET')return canAccess(role,resource,policies)||canLookup(role,resource,policies);
  if(immutableResources.includes(resource)&&method!=='POST')return false;
  const rules=policies?.[role];
  if(!rules?.resources?.[resource]?.GET||rules.resources[resource][method]!==true)return false;
  if(resource==='work-orders'&&row&&isHistory(row)) {
    if(method==='PUT')return rules.history?.edit===true;
    if(method==='DELETE')return rules.history?.delete===true;
  }
  return true;
}
