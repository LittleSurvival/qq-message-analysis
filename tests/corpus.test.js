import test from 'node:test';
import assert from 'node:assert/strict';
import {measurement,ranked,sameScope,scopeOf} from '../src/corpus/corpus-data.js';
test('occurrence ranks retain zeros, exclude unknown and enforce per-dimension samples',()=>{
 const members=[{id:'a',dimensions:{support:{count:0,valid:30}}},{id:'b',dimensions:{support:{count:2,valid:20}}},{id:'c',dimensions:{support:{count:0,valid:0}}}];
 assert.equal(measurement(members[0],'support','rate'),0);assert.equal(measurement(members[1],'support','rate'),10);assert.equal(measurement(members[2],'support','count'),null);
 assert.deepEqual(ranked(members,'support','rate',false).map(x=>x.id),['a']);assert.deepEqual(ranked(members,'support','rate',true).map(x=>x.id),['b','a']);
});
test('run scope uses applied report dates, ignores system checkbox and normalizes weekdays',()=>{
 const scope=scopeOf({filters:{from:'2026-10-01',to:'2026-10-31',weekdays:[6,5],includeSystem:true}});
 assert.ok(sameScope({from:'2026-10-01',to:'2026-10-31',weekdays:[5,6]},scope));assert.ok(!sameScope({},scope));
});
