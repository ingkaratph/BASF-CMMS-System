import {existsSync,readFileSync,writeFileSync,renameSync,mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {roles,defaultPermissions,permissionResources,permissionPages,permissionMethods,immutableResources} from '../shared/permissions.mjs';

export function validateRolePermissions(value) {
  const exact=(obj,keys)=>obj&&typeof obj==='object'&&!Array.isArray(obj)&&Object.keys(obj).length===keys.length&&keys.every(k=>Object.hasOwn(obj,k));
  if(!exact(value,['pages','resources','history'])||!exact(value.pages,permissionPages)||!exact(value.resources,permissionResources)||!exact(value.history,['edit','delete']))throw new Error('รูปแบบสิทธิ์ไม่ถูกต้อง');
  if([...Object.values(value.pages),...Object.values(value.history)].some(v=>typeof v!=='boolean'))throw new Error('สิทธิ์ต้องเป็นค่าเปิดหรือปิด');
  for(const resource of permissionResources){
    const rights=value.resources[resource];
    if(!exact(rights,permissionMethods)||Object.values(rights).some(v=>typeof v!=='boolean'))throw new Error('สิทธิ์ข้อมูลไม่ถูกต้อง');
    if(!rights.GET&&(rights.POST||rights.PUT||rights.DELETE))throw new Error('ต้องเปิดสิทธิ์ดูก่อนให้เพิ่ม แก้ไข หรือลบ');
    if(immutableResources.includes(resource)&&(rights.PUT||rights.DELETE))throw new Error('ประวัติรับ–เบิกและสอบเทียบไม่รองรับการแก้ไขหรือลบ');
  }
  if(value.history.edit&&!value.resources['work-orders'].PUT)throw new Error('การแก้ไขประวัติต้องมีสิทธิ์แก้ไขใบงาน');
  if(value.history.delete&&!value.resources['work-orders'].DELETE)throw new Error('การลบประวัติต้องมีสิทธิ์ลบใบงาน');
  if(value.pages.reports&&!['assets','work-orders','maintenance-plans','spare-parts'].every(r=>value.resources[r].GET))throw new Error('รายงานต้องมีสิทธิ์ดูเครื่องจักร ใบงาน แผน PM และอะไหล่');
}
export function createPermissionsStore(path){
  path=resolve(path);
  const initial=()=>({revision:0,roleVersions:Object.fromEntries(roles.map(r=>[r,1])),roles:defaultPermissions(),changes:[]});
  const read=()=>existsSync(path)?JSON.parse(readFileSync(path,'utf8')):initial();
  return {
    read,
    update(role,value,revision,actor){
      if(!roles.includes(role)||role==='ADMINISTRATOR')throw new Error('สิทธิ์ Administrator ถูกสงวนไว้เพื่อให้ผู้ดูแลเข้าถึงระบบได้เสมอ');
      const state=read();
      if(!Number.isSafeInteger(revision)||revision!==state.revision){const e=new Error('มีผู้แก้ไขสิทธิ์ก่อนหน้านี้ กรุณาโหลดค่าล่าสุด');e.status=409;throw e;}
      validateRolePermissions(value);
      const next={...state,revision:state.revision+1,roles:{...state.roles,[role]:structuredClone(value)},roleVersions:{...state.roleVersions,[role]:state.roleVersions[role]+1},changes:[...state.changes,{at:new Date().toISOString(),by:actor,role,before:state.roles[role],after:value}].slice(-100)};
      mkdirSync(dirname(path),{recursive:true});writeFileSync(path+'.tmp',JSON.stringify(next,null,2),{mode:0o600});renameSync(path+'.tmp',path);return next;
    }
  };
}
