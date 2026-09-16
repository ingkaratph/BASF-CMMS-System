import test from 'node:test';
import assert from 'node:assert/strict';
import {issueSequentially} from '../src/issue-batch.mjs';
test('batch issues selected pending parts once and preserves quantity',async()=>{
 const lines=[{id:1,quantity:2,state:'pending'},{id:2,quantity:3,state:'pending'},{id:3,state:'saved'}];const sent=[];
 assert.equal(await issueSequentially(lines,async l=>sent.push([l.id,l.quantity]),(l,state)=>l.state=state),2);
 assert.deepEqual(sent,[[1,2],[2,3]]);
 await issueSequentially(lines,async l=>sent.push(l.id),(l,state)=>l.state=state);
 assert.equal(sent.length,2);
});
test('partial failure stops batch and excludes successful and uncertain items on continuation',async()=>{
 const lines=[1,2,3].map(id=>({id,state:'pending'}));const sent=[];
 assert.equal(await issueSequentially(lines,async l=>{sent.push(l.id);if(l.id===2)throw Error('connection lost')},(l,state)=>l.state=state),1);
 assert.deepEqual(lines.map(l=>l.state),['saved','uncertain','pending']);
 await issueSequentially(lines,async l=>sent.push(l.id),(l,state)=>l.state=state);
 assert.deepEqual(sent,[1,2,3]);
});
