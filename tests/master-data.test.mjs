import test from 'node:test';import assert from 'node:assert/strict';import express from 'express';
import {validateVendor,vendorVersion,installMasterDataRoutes} from '../server/master-data.mjs';
import {canAccess,canPerform,defaultPermissions} from '../shared/permissions.mjs';
test('vendor validates lengths, active state, email and edit version',()=>{
 const v={VendorName:' Test ',VendorCode:' T ',ContactName:'',Email:'a@b.com',Phone:'',IsActive:true};assert.equal(validateVendor(v).VendorName,'Test');assert.equal(validateVendor(v).ContactName,null);
 for(const body of [{...v,VendorName:''},{...v,Email:'bad'},{...v,Phone:'a'.repeat(81)},{...v,VendorID:5},{...v,IsActive:'true'}])assert.throws(()=>validateVendor(body));
 assert.throws(()=>validateVendor(v,true));assert.doesNotThrow(()=>validateVendor({...v,Version:vendorVersion(v)},true));assert.notEqual(vendorVersion(v),vendorVersion({...v,Phone:'123'}));
});
test('master routes enforce role and configured permissions and preserve conflicts',async()=>{
 const app=express();app.use(express.json());let calls=0;let conflict=false;const policy=defaultPermissions();app.use((req,res,next)=>{req.role=req.headers['x-test-role'];next()});
 const service={vendors:async()=>[{VendorID:1,VendorName:'Test'}],saveVendor:async(id,body)=>{validateVendor(body,id!==null);calls++;if(conflict)throw Object.assign(Error('changed'),{status:409});return {VendorID:id||2,...body}},calibrationPoints:async()=>[{PointNo:1,SetpointValue:0}],pmHistory:async()=>({completedWorkOrders:[],lastPlanDates:[]})};
 installMasterDataRoutes(app,service,(req,page)=>canAccess(req.role,page,policy),(req,method)=>['ADMINISTRATOR','PLANNER'].includes(req.role)&&canPerform(req.role,'maintenance-plans',method,undefined,policy));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 const req=(path,role,method='GET',body)=>fetch(base+path,{method,headers:{'x-test-role':role,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 try{
 assert.equal((await req('/api/vendors','PRODUCTION')).status,403);assert.equal((await req('/api/vendors','TECHNICIAN')).status,200);
 const body={VendorName:'Test',IsActive:true};assert.equal((await req('/api/vendors','TECHNICIAN','POST',body)).status,403);assert.equal(calls,0);
 assert.equal((await req('/api/vendors','PLANNER','POST',body)).status,200);assert.equal(calls,1);
 policy.PLANNER.resources['maintenance-plans'].POST=false;assert.equal((await req('/api/vendors','PLANNER','POST',body)).status,403);
 conflict=true;assert.equal((await req('/api/vendors/1','ADMINISTRATOR','PUT',{...body,Version:vendorVersion(body)})).status,409);
 assert.equal((await req('/api/vendors/1x','ADMINISTRATOR','PUT',body)).status,400);
 assert.equal((await req('/api/calibration-points','TECHNICIAN')).status,200);assert.equal((await req('/api/calibration-points','PRODUCTION')).status,403);
 assert.equal((await req('/api/pm-history','PLANNER')).status,200);assert.equal((await req('/api/pm-history','PRODUCTION')).status,403);
 }finally{await new Promise(r=>server.close(r))}
});
