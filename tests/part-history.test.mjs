import test from 'node:test';import assert from 'node:assert/strict';import express from 'express';import {installMasterDataRoutes} from '../server/master-data.mjs';
test('part history validates IDs and requires both history and inventory access',async()=>{
 const app=express();const calls=[];
 installMasterDataRoutes(app,{partHistory:async(id,page)=>{calls.push([id,page]);return {rows:[],total:0}}},(req,page)=>req.headers['x-deny']!==page,()=>false);
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 try{for(const denied of ['spare-parts','stock-transactions'])assert.equal((await fetch(base+'/api/parts/1/history',{headers:{'x-deny':denied}})).status,403);
 for(const path of ['/api/parts/abc/history','/api/parts/1/history?page=-1','/api/parts/1/history?page=9999999'])assert.equal((await fetch(base+path)).status,400);
 assert.equal(calls.length,0);assert.equal((await fetch(base+'/api/parts/123/history?page=2')).status,200);assert.deepEqual(calls,[['123',2]]);
 }finally{await new Promise(r=>server.close(r))}
});
