import test from 'node:test';
import assert from 'node:assert/strict';
import {avatarDataURL,avatarMarkup,anonymousMember} from '../src/shared/avatars.js';
import {analyzeFile} from '../src/analysis/importer.js';
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=';
const message=(uid,uin,time='2026-10-02T00:00:00+08:00')=>({id:uid,timestamp:Date.parse(time),sender:{uid,uin,name:'同名'},content:{elements:[{type:'text',data:{text:'你好'}}]}});
const file=value=>{const bytes=new TextEncoder().encode(JSON.stringify(value));return {name:'avatars.json',size:bytes.length,stream:()=>new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=13)c.enqueue(bytes.slice(i,i+13));c.close();}})};}; 
test('QCE uin avatars before or after messages map to stable uid without name matching',async()=>{
 const messages=[message('uid-a','123'),message('uid-b','456'),message('uid-c','789')];
 for(const input of [{avatars:{123:png,'uid-b':png},messages},{messages,avatars:{123:png,'uid-b':png}}]){
  const r=await analyzeFile(file(input));assert.equal(r.members[0].avatar,png);assert.equal(r.members[1].avatar,png);assert.equal(r.members[2].avatar,undefined);assert.equal(r.total,3);
 }
});
test('avatar identity links survive filtering and reject ambiguous uin associations',async()=>{
 const r=await analyzeFile(file({messages:[message('a','123','2026-10-01T00:00:00+08:00'),message('a',''),message('b','456'),message('b','789')],avatars:{123:png,456:png,789:png}}),{from:'2026-10-02'});
 assert.equal(r.members.find(m=>m.id==='a').avatar,png);assert.equal(r.members.find(m=>m.id==='b').avatar,undefined);assert.equal(r.total,3);
});
test('avatars are embedded raster only; malformed, external and oversized values never enter markup',()=>{
 for(const value of ['https://example.com/avatar.png','./avatars/1.jpg','data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,PHNjcmlwdD4=',null,{},'data:image/png;base64,'+'A'.repeat(3*1024*1024)])assert.equal(avatarDataURL(value),null);
 assert.equal(avatarDataURL(png.replace('image/png','image/jpeg')),png);
 assert.ok(avatarMarkup({avatar:png},'<甲>').includes('data-avatar'));
 assert.ok(!avatarMarkup({avatar:'https://example.com/a'},'甲').includes('<img'));
 assert.ok(!avatarMarkup({avatar:png},'成員 001',{anonymous:true}).includes('<img'));
 assert.ok(avatarMarkup({},'<甲>').includes('&lt;'));
 assert.deepEqual(anonymousMember({id:'real',name:'甲',avatar:png,total:5},'成員 001'),{id:'成員 001',name:'成員 001',total:5});
});
