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
import {stockSummary,compliance,backlogAge} from '../src/report-data.mjs';
test('stock costs preserve currency, use recorded cost first, and subtract returns',()=>{
 const parts=[{PartID:1,StandardCost:50,CurrencyCode:'THB'},{PartID:2,StandardCost:20,CurrencyCode:'EUR'}];
 const rows=[{PartID:1,TransactionType:'ISSUE',Quantity:2,UnitCost:10,TransactionDate:'2026-01-01'},{PartID:1,TransactionType:'RETURN',Quantity:1,UnitCost:10,TransactionDate:'2026-01-02'},{PartID:2,TransactionType:'RECEIVE',Quantity:3,UnitCost:5,TransactionDate:'2026-01-03'},{PartID:1,TransactionType:'ISSUE',Quantity:2,UnitCost:null,TransactionDate:'2026-02-01'},{PartID:99,TransactionType:'ISSUE',Quantity:1,UnitCost:10,TransactionDate:'2026-01-01'}];
 const actual=stockSummary(rows,parts);assert.equal(actual.valued,3);assert.equal(actual.excluded,2);assert.equal(actual.summaries.find(c=>c.currency==='THB').net,10);assert.equal(actual.summaries.find(c=>c.currency==='EUR').receive,15);assert.equal(actual.summaries.find(c=>c.currency==='EUR').issue,null);
 const estimated=stockSummary(rows,parts,true);assert.equal(estimated.estimated,1);assert.equal(estimated.summaries.find(c=>c.currency==='THB').net,110);assert.equal(estimated.excluded,1);
});
test('stock missing dates, negative quantities, zero costs, unknown types and return-only months',()=>{
 const s=stockSummary([{TransactionTypeCode:'RETURN',PartID:1,Quantity:2,UnitCost:4,TransactionDate:'2026-01-01'},{TransactionTypeCode:'ISSUE',PartID:1,Quantity:1,UnitCost:0},{TransactionTypeCode:'ISSUE',PartID:1,Quantity:-1,UnitCost:5},{TransactionTypeCode:'ADJUST',PartID:1,Quantity:2,UnitCost:5}],[{PartID:1,CurrencyCode:'THB'}]);
 assert.equal(s.valued,2);assert.equal(s.undated,1);assert.equal(s.excluded,1);assert.equal(s.unknownType,1);assert.equal(s.summaries[0].months[0].net,-8);assert.equal(s.summaries[0].issue,0);
});
test('compliance uses completed valid dates only; backlog handles missing dates',()=>{
 const rows=[{StatusCode:'COMPLETED',DueDate:'2026-01-05',ActualFinish:'2026-01-04'},{StatusCode:'CLOSED',DueDate:'2026-01-05',ActualFinish:'2026-01-06'},{StatusCode:'COMPLETED',DueDate:null},{StatusCode:'CANCELLED',DueDate:'2026-01-05',ActualFinish:'2026-01-04'},{StatusCode:'OPEN',RequestedDate:'2026-01-01'},{StatusCode:'OPEN',RequestedDate:null}];
 assert.deepEqual(compliance(rows),{eligible:2,missing:1,onTime:1,rate:50});assert.equal(compliance([]).rate,null);const ages=backlogAge(rows,new Date('2026-01-10'));assert.equal(ages.find(x=>x.label==='8–30 วัน').value,1);assert.equal(ages.at(-1).value,1);
});
test('missing currency is excluded unless user explicitly supplies a reporting assumption',()=>{
 const rows=[{PartID:1,TransactionType:'ISSUE',Quantity:2,UnitCost:4,TransactionDate:'2026-01-01'}];
 assert.equal(stockSummary(rows,[]).valued,0);const s=stockSummary(rows,[],false,'THB');assert.equal(s.valued,1);assert.equal(s.assumedCurrency,1);assert.equal(s.missingCurrency,1);assert.equal(s.summaries[0].net,8);assert.equal(s.inferredCurrency,0);
 const own=stockSummary([{...rows[0],CurrencyCode:'EUR'}],[],false,'THB');assert.equal(own.summaries[0].currency,'EUR');assert.equal(own.assumedCurrency,0);
});
