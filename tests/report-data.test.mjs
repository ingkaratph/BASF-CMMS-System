import test from 'node:test';
import assert from 'node:assert/strict';
import {maintenanceSummary,number,group} from '../src/report-data.mjs';
test('maintenance totals exclude cancelled and unknown downtime; do not turn missing into zero',()=>{
 const rows=[{AssetID:1,DowntimeMinutes:120,StatusCode:'COMPLETED',ActualStart:'2026-08-01T00:00:00',ActualFinish:'2026-08-01T02:00:00'},{AssetID:1,DowntimeMinutes:30,StatusCode:'OPEN',RequestedDate:'2026-09-01'},{AssetID:2,DowntimeMinutes:null},{AssetID:3,DowntimeMinutes:-5},{AssetID:4,DowntimeMinutes:999,StatusCode:'CANCELLED'},{AssetID:5,DowntimeMinutes:0}];
 const s=maintenanceSummary(rows,[{AssetID:1,MachineCode:'M-1',AssetName:'Pump'}]);
 assert.equal(s.totalHours,2.5);assert.equal(s.measured,3);assert.equal(s.missing,2);assert.equal(s.machines.length,1);assert.equal(s.machines[0].value,2.5);assert.equal(s.meanRepairHours,2);assert.equal(s.durationCount,1);assert.equal(s.trend.length,12);assert.deepEqual(s.trend.at(-1),{label:'2026-09',value:.5});assert.equal(s.undated,1);
});
test('empty and invalid data do not invent repair durations or downtime',()=>{
 assert.equal(number({Quantity:''},'Quantity'),null);assert.equal(number({Quantity:'bad'},'Quantity'),null);
 const s=maintenanceSummary([{DowntimeMinutes:60,ActualStart:'1900-12-30',RequestedDate:null,ActualFinish:'2026-01-01',StatusCode:'COMPLETED'}],[]);
 assert.equal(s.totalHours,1);assert.equal(s.trend.length,0);assert.equal(s.meanRepairHours,null);assert.equal(s.undated,1);assert.equal(maintenanceSummary([],[]).measured,0);
 assert.deepEqual(group([{Status:'OPEN'},{Status:'OPEN'}],r=>r.Status),[{label:'OPEN',value:2}]);
});
