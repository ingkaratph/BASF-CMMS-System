import {prepareUser,publicUser,verifyPassword} from './users.mjs';
import {validateRolePermissions} from './permissions-store.mjs';
import {roles} from '../shared/permissions.mjs';

// Service-only API. Credential hashes never leave the backend for the browser.
export function createIdentityApi(base,key) {
  async function call(operation,body={}) {
    let response,json;
    try {
      response=await fetch(`${base.replace(/\/$/,'')}/cmms/identity/storage`,{
        method:'POST',headers:{'Content-Type':'application/json','x-api-key':key},
        body:JSON.stringify({operation,...body}),signal:AbortSignal.timeout(12000)
      });
      json=await response.json();
    }catch {throw Object.assign(new Error('เชื่อมต่อฐานข้อมูลไม่ได้'),{status:503});}
    if(!response.ok||!json.ok)throw Object.assign(new Error(response.status===409?'ข้อมูลถูกแก้ไขแล้ว กรุณาโหลดค่าล่าสุด':'เชื่อมต่อฐานข้อมูลไม่ได้'),{status:response.status===409?409:503});
    const data=json.data;
    try {
      if(!Array.isArray(data?.users)||!Number.isSafeInteger(data.usersRevision)||!Number.isSafeInteger(data.permissions?.revision))throw new Error();
      for(const role of roles){
        if(!Number.isSafeInteger(data.permissions.roleVersions[role]))throw new Error();
        validateRolePermissions(data.permissions.roles[role]);
      }
    }catch{throw Object.assign(new Error('เชื่อมต่อฐานข้อมูลไม่ได้'),{status:503});}
    return data;
  }
  return {
    read:()=>call('READ'),
    authenticate(snapshot,username,password){
      const u=snapshot.users.find(u=>u.username===String(username).trim().toLowerCase());
      // Perform the same expensive hash check for unknown/disabled accounts.
      const valid=verifyPassword(password,u?.passwordHash||'unrecognized-user:'+ '00'.repeat(64));
      return valid&&u?.active?publicUser(u):null;
    },
    async saveUser(id,body,actorId) {
      const state=await call('READ');
      const user=prepareUser(state.users,id,body,actorId);
      await call('SAVE_USER',{user,revision:state.usersRevision,actor:actorId});
      return publicUser(user);
    },
    async updatePermissions(role,value,revision,actor) {
      if(!roles.includes(role)||role==='ADMINISTRATOR')throw new Error('ไม่สามารถแก้ไขสิทธิ์ Administrator');
      validateRolePermissions(value);
      return (await call('SAVE_PERMISSIONS',{role,permissions:value,revision,actor})).permissions;
    },
  };
}
