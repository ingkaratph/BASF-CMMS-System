import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,unlinkSync,rmdirSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {parsePriceText,valueInventory,bangkokMonth} from '../server/inventory-value.mjs';
import {createInventoryValuation} from '../server/inventory-valuation.mjs';
test('PriceText rejects ambiguous entries and preserves zero and explicit currencies',()=>{
 assert.equal(parsePriceText('12,700.50'),12700.5);assert.equal(parsePriceText('THB 6000'),6000);assert.equal(parsePriceText('0'),0);
 for(const raw of ['ยังไม่เคยซื้อ','1-200','1 USD 2','1,23','-50','THB 10 EUR',null,['500','500'],[500,500],{toString:()=> '500'}])assert.equal(parsePriceText(raw),null);
 const v=valueInventory([{PartID:1,Quantity:2,PriceText:'100',StandardCost:999},{PartID:2,Quantity:3,PriceText:'EUR 10'},{PartID:3,Quantity:1,PriceText:'ยังไม่เคยซื้อ'},{PartID:4,Quantity:0,PriceText:null},{PartID:5,Quantity:5,PriceText:'0'},{PartID:6,Quantity:-1,PriceText:'100'}]);
 assert.equal(v.totals.find(x=>x.currency==='THB').value,200);assert.equal(v.totals.find(x=>x.currency==='EUR').value,30);assert.equal(v.missingPrice,1);assert.equal(v.invalidQuantity,1);assert.equal(v.zeroPrice,1);assert.equal(v.inStock,4);
 assert.equal(valueInventory([{PartID:1,Quantity:2,PriceText:'EUR 10',CurrencyCode:'THB'}]).missingPrice,1);
});
test('monthly valuations freeze prior prices, update current month and survive service recreation',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'cmms-values-')),file=join(dir,'history.json');let now=new Date('2026-01-31T16:30:00Z'),price='10',fail=false;
 const readRows=async()=>{if(fail)throw Error('offline');return [{PartID:1,Quantity:2,PriceText:price}]};
 try{const service=createInventoryValuation({file,readRows,now:()=>now});await service.capture();price='20';await service.capture();now=new Date('2026-01-31T17:00:00Z');price='30';const result=await service.capture();
 assert.equal(bangkokMonth(now),'2026-02');assert.equal(result.history.length,2);assert.equal(result.history[0].totals[0].value,40);assert.equal(result.history[1].totals[0].value,60);
 const reopened=createInventoryValuation({file,readRows,now:()=>now});assert.equal((await reopened.capture()).history[0].totals[0].value,40);
 const before=readFileSync(file,'utf8');fail=true;await assert.rejects(service.capture());assert.equal(readFileSync(file,'utf8'),before);
 }finally{unlinkSync(file);rmdirSync(dir)}
});
