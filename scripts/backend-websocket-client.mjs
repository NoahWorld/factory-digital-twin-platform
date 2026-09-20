// Minimal RFC 6455 test client, so smoke tests need no extra runtime dependency.
import {connect} from 'node:net';
import {randomBytes} from 'node:crypto';
import {EventEmitter} from 'node:events';
export async function websocket(cookie,origin='http://127.0.0.1:18080'){
 const socket=connect(18080,'127.0.0.1'),events=new EventEmitter(),messages=[];let buffer=Buffer.alloc(0),upgraded=false,closed=false,failure;
 function frame(opcode,data){const mask=randomBytes(4),head=Buffer.alloc(data.length<126?6:8);head[0]=128|opcode;if(data.length<126){head[1]=128|data.length;mask.copy(head,2);}else{head[1]=254;head.writeUInt16BE(data.length,2);mask.copy(head,4);}const bytes=Buffer.from(data);for(let i=0;i<bytes.length;i++)bytes[i]^=mask[i%4];socket.write(Buffer.concat([head,bytes]));}
 socket.on('error',e=>{failure=e;events.emit('change');});socket.on('close',()=>{closed=true;events.emit('change');});
 socket.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);if(!upgraded){const end=buffer.indexOf('\r\n\r\n');if(end<0)return;const header=buffer.subarray(0,end).toString();if(!header.startsWith('HTTP/1.1 101')){failure=new Error('WebSocket handshake rejected: '+header.split('\r\n')[0]);events.emit('change');socket.destroy();return;}buffer=buffer.subarray(end+4);upgraded=true;}
  while(buffer.length>=2){const opcode=buffer[0]&15;let size=buffer[1]&127,offset=2;if(size===126){if(buffer.length<4)return;size=buffer.readUInt16BE(2);offset=4;}else if(size===127){if(buffer.length<10)return;size=Number(buffer.readBigUInt64BE(2));offset=10;}if(buffer.length<offset+size)return;const data=buffer.subarray(offset,offset+size);buffer=buffer.subarray(offset+size);if(opcode===1){messages.push(JSON.parse(data.toString()));events.emit('change');}if(opcode===8){socket.end();closed=true;events.emit('change');}if(opcode===9)frame(10,data);}
 });
 socket.on('connect',()=>socket.write(`GET /api/v1/realtime HTTP/1.1\r\nHost: 127.0.0.1:18080\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\nOrigin: ${origin}\r\nCookie: ${cookie}\r\n\r\n`));
 function wait(predicate,timeout=8000){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>finish(new Error('WebSocket event timed out')),timeout);function finish(error,value){clearTimeout(timer);events.off('change',check);error?reject(error):resolve(value);}function check(){if(failure)return finish(failure);const i=messages.findIndex(predicate);if(i>=0)return finish(null,messages.splice(i,1)[0]);if(closed)return finish(new Error('WebSocket closed'));}events.on('change',check);check();});}
 const client={send:value=>frame(1,Buffer.from(JSON.stringify(value))),wait,close:()=>socket.destroy()};try{await wait(m=>m.type==='hello');return client;}catch(e){socket.destroy();throw e;}
}
