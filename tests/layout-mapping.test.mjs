import test from 'node:test';
import assert from 'node:assert/strict';
import {mapLayout} from '../src/layout-mapping.mjs';
const machine={id:'coater-0',name:'X-105 — Coater',category:'machines'};
const area={id:'slurry',category:'buildings'};
test('unique exact CAD tag links assets and work orders by AssetID, never conflicting ID',()=>{
 const asset={AssetID:10,MachineCode:'X-105',TagNo:'COATER-1'};
 const a={AssetID:10,StatusCode:'OPEN',PriorityCode:'URGENT'};
 const b={AssetID:99,MachineCode:'X-105',StatusCode:'OPEN'};
 const r=mapLayout([machine],[asset],[a,b]);assert.deepEqual(r.entries[0].assets,[asset]);assert.deepEqual(r.entries[0].workOrders,[a]);assert.equal(r.entries[0].state,'urgent');assert.deepEqual(r.unmappedWorkOrders,[b]);
});
test('ambiguous tag and similar names remain unmapped',()=>{
 const r=mapLayout([machine],[{AssetID:1,TagNo:'X-105'},{AssetID:2,MachineCode:'X-105'}],[{TagNo:'X-105'}]);assert.equal(r.entries[0].state,'ambiguous');assert.equal(r.entries[0].assets.length,0);assert.equal(r.entries[0].workOrders.length,0);
 assert.equal(mapLayout([machine],[{AssetName:'X-105 Coater',TagNo:'X-105-A'}],[]).matchedObjects,0);
});
test('normalization handles case and whitespace, closed/cancelled jobs do not color open',()=>{
 const r=mapLayout([machine],[{assetid:1,tagno:' x - 105 '}],[{TagNo:'X-105',StatusCode:'CLOSED'},{AssetID:1,StatusCode:'CANCELLED'}]);assert.equal(r.entries[0].state,'matched');assert.equal(r.entries[0].activeCount,0);
});
test('missing data is unknown, never a healthy status, and work order alone cannot identify machine',()=>{
 assert.equal(mapLayout([machine],[{AssetID:1,TagNo:'X-105'}],undefined).entries[0].state,'unknown');
 assert.equal(mapLayout([machine],undefined,[{TagNo:'X-105'}]).matchedObjects,0);
});
test('Area uses explicit name fields, does not infer from numeric LocationID or machine names',()=>{
 const a={AssetID:1,LocationName:'Slurry Building'},b={AssetID:2,LocationID:22,AssetName:'Slurry'};
 const j={AssetID:1,StatusCode:'OPEN'},direct={AreaName:'SLURRY',StatusCode:'OPEN'};
 const r=mapLayout([area],[a,b],[j,direct]);assert.deepEqual(r.entries[0].assets,[a]);assert.equal(r.entries[0].workOrders.length,2);assert.equal(r.entries[0].kind,'area');assert.deepEqual(r.unmappedAssets,[b]);
});
