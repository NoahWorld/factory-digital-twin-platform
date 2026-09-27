import assert from 'node:assert/strict';
import { Group, Mesh, BoxGeometry, MeshStandardMaterial } from 'three';
import { roomAlarmObservations } from '../src/twin/useRoomAlarmData.ts';
import { RoomAlarmRuntime } from '../src/scene/room-alarm-runtime.ts';

const rule = { id:'fire-rule',label:'Fire',enabled:true,source:{projectId:'project',assetId:'room',metricKey:'fire'},target:{instanceId:'building',modelAssetId:'model',nodeName:'room_A'},condition:{operator:'eq',value:true},color:'#ff0000' };
const asset = { id:'asset-record',projectId:'project',assetId:'room' };
const t = Date.parse('2026-09-27T10:00:00Z'), iso = value => new Date(value).toISOString();
function sources(value, time) {
  return [{projectId:'project',label:'Project',assets:[asset],loading:false,error:null,connections:{'asset-record':{status:'live',failureCount:0,snapshot:{
    asset, timestamp:iso(t), values:{slow:false,fire:value},staleAfterSeconds:3,pollAfterSeconds:1,
    metrics:[{metricKey:'slow',value:false,staleAfterSeconds:60,sourceId:'slow',timestamp:iso(t),collectedAt:iso(t),quality:'good'},
      {metricKey:'fire',value,staleAfterSeconds:3,sourceId:'fast',timestamp:iso(time),collectedAt:iso(time),quality:'good'}],
    sources:[{id:'slow',collectedAt:iso(t),sourceTimestamp:iso(t)},{id:'fast',collectedAt:iso(time),sourceTimestamp:iso(time)}],
  }}}}];
}
const model = new Group(), mesh = new Mesh(new BoxGeometry(),new MeshStandardMaterial({color:'#abcdef'}));mesh.name='room_A';model.add(mesh);
const record = {id:'building',assetId:'model',model,objectsByName:new Map([['room_A',[mesh]]])};
const runtime = new RoomAlarmRuntime();runtime.reconcile([record],[rule]);
const first = roomAlarmObservations([rule],sources(false,t+1000));
assert.equal(first['fire-rule'].timestamp,iso(t+1000));
assert.equal(runtime.update(first,t+1001)[0].state,'normal');
const second = roomAlarmObservations([rule],sources(true,t+2000));
assert.equal(second['fire-rule'].timestamp,iso(t+2000));
assert.equal(runtime.update(second,t+2001)[0].state,'alarm');
assert.equal(runtime.update(second,t+2002)[0].state,'alarm');
assert.equal(runtime.update(second,t+6000)[0].state,'stale');
assert.equal(runtime.update(second,t+6000)[0].active,true);
const wrong=sources(false,t+7000);wrong[0].connections['asset-record'].snapshot.metrics[1].sourceId='missing';
assert.equal(roomAlarmObservations([rule],wrong)['fire-rule'].status,'offline');
const mixed=sources(false,t+7000);mixed[0].connections['asset-record'].snapshot.metrics[1].value=true;
assert.equal(roomAlarmObservations([rule],mixed)['fire-rule'].status,'offline');
const old=sources(false,t+7000);delete old[0].connections['asset-record'].snapshot.metrics[1].timestamp;
assert.equal(roomAlarmObservations([rule],old)['fire-rule'].status,'offline');
const delayed={...second['fire-rule'],timestamp:iso(t+8000),collectedAt:iso(t+2000)};
assert.equal(runtime.update({'fire-rule':delayed},t+8001)[0].state,'stale');
runtime.dispose();mesh.geometry.dispose();mesh.material.dispose();
console.log('Room metric data: per-source identity, slow/fast isolation, duplicate frames, TTL and contradictory payload rejection passed.');
