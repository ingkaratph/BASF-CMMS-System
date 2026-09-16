import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
import {defaultPermissions,roles} from '../shared/permissions.mjs';
import {hashPassword,prepareUser} from '../server/users.mjs';
import {validateRolePermissions,createPermissionsStore} from '../server/permissions-store.mjs';
import {mkdtempSync,unlinkSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('custom policies persist, validate dependencies, protect admin and reject concurrent overwrites',()=>{
 const dir=mkdtempSync(join(tmpdir(),'cmms-policy-')),file=join(dir,'policy.json');
 try{
  const store=createPermissionsStore(file),policy=defaultPermissions().TECHNICIAN;
  policy.resources.assets.PUT=true;
  const saved=store.update('TECHNICIAN',policy,0,'admin');
  assert.equal(saved.roleVersions.TECHNICIAN,2);
  assert.equal(createPermissionsStore(file).read().roles.TECHNICIAN.resources.assets.PUT,true);
  assert.throws(()=>store.update('TECHNICIAN',policy,0,'admin'),e=>e.status===409);
  assert.throws(()=>store.update('ADMINISTRATOR',policy,1,'admin'));
  policy.resources.assets.GET=false;assert.throws(()=>validateRolePermissions(policy));
 }finally{unlinkSync(file);rmdirSync(dir)}
});

test('SQL identity mode uses service API, enforces custom rights, revokes sessions and fails closed',async()=>{
 const state={usersRevision:0,users:[{id:randomBytes(12).toString('hex'),username:'admin',displayName:'Admin',role:'ADMINISTRATOR',active:true,version:1,passwordHash:hashPassword('database-admin-password')}],permissions:{revision:0,roles:defaultPermissions(),roleVersions:Object.fromEntries(roles.map(r=>[r,1])),changes:[]}};
 let unavailable=false,reads=0;
 const api=http.createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json');
  if(req.url!='/cmms/identity/storage'){res.end(JSON.stringify({ok:true,data:{recordset:[]},role:'ADMIN'}));return;}
  assert.equal(req.headers['x-api-key'],'test-service-key');
  if(unavailable){res.writeHead(503).end(JSON.stringify({ok:false}));return;}
  let raw='';for await(const part of req)raw+=part;
  const body=JSON.parse(raw);reads++;
  if(body.operation==='SAVE_USER'){
   if(body.revision!==state.usersRevision){res.writeHead(409).end(JSON.stringify({ok:false}));return;}
   state.users=state.users.filter(u=>u.id!==body.user.id).concat(body.user);state.usersRevision++;
  }
  if(body.operation==='SAVE_PERMISSIONS'){
   if(body.revision!==state.permissions.revision){res.writeHead(409).end(JSON.stringify({ok:false}));return;}
   state.permissions.roles[body.role]=body.permissions;state.permissions.revision++;state.permissions.roleVersions[body.role]++;
  }
  res.end(JSON.stringify({ok:true,data:state}));
 });
 api.listen(0,'127.0.0.1');await once(api,'listening');
 const reserve=http.createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const port=reserve.address().port;await new Promise(r=>reserve.close(r));
 const child=spawn(process.execPath,['server/index.mjs','--production'],{env:{...process.env,PORT:String(port),HOST:'127.0.0.1',CMMS_IDENTITY_STORAGE:'database',CMMS_API_BASE_URL:`http://127.0.0.1:${api.address().port}`,CMMS_API_KEY_ADMIN:'test-service-key',CMMS_API_KEY:'test-service-key',CMMS_APP_PASSWORD:'local-password-must-not-work'}});
 let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
 const base=`http://127.0.0.1:${port}`;
 const call=async(path,method='GET',body,cookie)=>{const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
 try{
  for(let i=0;i<60;i++){try{await fetch(base+'/api/session');break}catch{await new Promise(r=>setTimeout(r,100))}}
  let r=await call('/api/login','POST',{username:'admin',password:'local-password-must-not-work'});assert.equal(r.status,401,logs);
  const login=await call('/api/login','POST',{username:'admin',password:'database-admin-password'});assert.equal(login.status,200,logs);assert.ok(!JSON.stringify(login.body).includes('passwordHash'));
  const cookie=login.cookie;
  r=await call('/api/users','POST',{username:'tech',displayName:'Tech',role:'TECHNICIAN',password:'technician-password'},cookie);assert.equal(r.status,201);const uid=r.body.data.id;
  const tech=await call('/api/login','POST',{username:'tech',password:'technician-password'});assert.equal(tech.status,200);
  assert.equal((await call('/api/permissions','GET',null,tech.cookie)).status,403);
  assert.equal((await call('/api/cmms/assets','POST',{},tech.cookie)).status,403);
  const policy=structuredClone(state.permissions.roles.TECHNICIAN);policy.pages.overview=false;
  r=await call('/api/permissions/TECHNICIAN','PUT',{revision:0,permissions:policy},cookie);assert.equal(r.status,200);
  assert.equal((await call('/api/session','GET',null,tech.cookie)).body.authenticated,false);
  assert.equal((await call('/api/permissions/TECHNICIAN','PUT',{revision:0,permissions:policy},cookie)).status,409);
  const tech2=await call('/api/login','POST',{username:'tech',password:'technician-password'});assert.equal(tech2.body.permissions.TECHNICIAN.pages.overview,false);
  r=await call('/api/users/'+uid,'PUT',{active:false},cookie);assert.equal(r.status,200);
  assert.equal((await call('/api/session','GET',null,tech2.cookie)).body.authenticated,false);
  assert.equal((await call('/api/login','POST',{username:'tech',password:'technician-password'})).status,401);
  assert.ok(reads>10);
  unavailable=true;
  r=await call('/api/login','POST',{username:'admin',password:'database-admin-password'});assert.equal(r.status,503);assert.equal(r.body.error.message,'เชื่อมต่อฐานข้อมูลไม่ได้');
  assert.equal((await call('/api/users','GET',null,cookie)).status,503);
 }finally{child.kill();await once(child,'exit');api.closeAllConnections();await new Promise(r=>api.close(r));}
});
