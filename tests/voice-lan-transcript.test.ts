import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { LanVoiceBrowserConnections } from "../src/voice/lan/browser-connections.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { request } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { WebSocket } from "ws";
import { CodexVoiceSessionMessages } from "../src/voice/session-messages.ts";
import { LanVoiceTranscript } from "../src/voice/lan/transcript.ts";
import { LAN_VOICE_BROWSER_TRANSCRIPT_SCRIPT } from "../src/voice/lan/browser-transcript-script.ts";
import { LAN_VOICE_BROWSER_EVENTS_SCRIPT } from "../src/voice/lan/browser-events-script.ts";
import { startCodexLanVoiceServer } from "../src/voice/lan/server.ts";
import { createLanVoiceWebUi } from "../src/voice/lan/web-ui.ts";

const theme = { getFgAnsi: () => "\x1b[38;2;225;232;244m", getBgAnsi: () => "\x1b[48;2;16;21;30m" };
const model = () => runInNewContext(LAN_VOICE_BROWSER_TRANSCRIPT_SCRIPT + "; new Transcript()", { TextEncoder, TextDecoder });
const msg = (seq: number, text = "hello") => ({ type:"transcript.message", epoch:"epoch", message:{messageId:`m${seq}`, seq, revision:1, role:"assistant", source:"pi", status:"streaming", text} });

test("slow SSE consumers cannot retain an unbounded streaming text queue", () => {
	const connections=new LanVoiceBrowserConnections();let destroyed=false,writes=0;
	const emitter=new EventEmitter();
	const response=Object.assign(emitter,{writableEnded:false,writableLength:300*1024,write(){writes++;},destroy(){destroyed=true;emitter.emit('close');}});
	connections.connectEvents('slow',response as never,false);
	connections.sendControl('slow',{type:'transcript.message'});
	assert.equal(destroyed,true);assert.equal(writes,0);
});

test("live projection streams a stable ID, revisions, and only text content", () => {
	const events: any[] = [];
	const live = new LanVoiceTranscript(e => events.push(e));
	live.assistantStart();
	live.assistant([{type:"thinking", text:"SECRET"}, {type:"toolCall", text:"SECRET"}, {type:"text", text:"Hi"}], false);
	live.assistant([{type:"text", text:"Hi there"}], true);
	assert.equal(events.length, 2);
	assert.equal(events[0].message.messageId, events[1].message.messageId);
	assert.equal(events[1].message.revision, 2);
	assert.equal(events[1].message.status, "final");
	assert.doesNotMatch(JSON.stringify(events), /SECRET/);
	live.assistantStart(); live.assistant([{type:"text", text:"next"}], true);
	assert.notEqual(events[2].message.messageId, events[1].message.messageId);
	const epoch = live.identity().epoch;
	live.reset(); assert.notEqual(live.identity().epoch, epoch);
	assert.deepEqual(Object.keys(live.identity()).sort(), ["epoch","type"]);
});

test("projection bounds UTF-8 text, including voice finalizations", () => {
	const events: any[] = [];
	const live = new LanVoiceTranscript(e => events.push(e));
	live.finalized("你😀".repeat(10000), "user", "voice");
	assert.ok(Buffer.byteLength(events[0].message.text) <= 16384);
	assert.doesNotMatch(events[0].message.text, /�/);
});

test("mobile model deduplicates stale revision, epoch, final rollback and evicted IDs", () => {
	const m = model(); m.reset("epoch");
	assert.equal(m.apply(msg(1)), true); assert.equal(m.apply(msg(1)), false);
	const final = msg(1); final.message.revision=2; final.message.status="final";
	assert.equal(m.apply(final), true);
	const rollback = msg(1); rollback.message.revision=3;
	assert.equal(m.apply(rollback), false);
	assert.equal(m.apply({...msg(2),epoch:"old"}), false);
	for (let i=2;i<=50;i++) m.apply(msg(i));
	assert.equal(m.rows.size,30); assert.equal(m.apply(msg(1)),false);
	assert.equal(m.reset("epoch"),false); assert.equal(m.rows.size,30);
	m.reset("new"); assert.equal(m.rows.size,0);
});

test("mobile model caps both per-row bytes and aggregate including metadata", () => {
	const m = model(); m.reset("epoch");
	for (let i=1;i<=100;i++) m.apply(msg(i,"你😀".repeat(10000)));
	assert.ok(m.rows.size <= 30);
	assert.ok(Buffer.byteLength(JSON.stringify(m.list())) <= 131072);
	for (const row of m.list()) { assert.ok(Buffer.byteLength(row.text)<=16384); assert.doesNotMatch(row.text,/�/); }
	const tool = msg(101); tool.message.role="tool"; assert.equal(m.apply(tool),false);
});

test("working/settled are status only and never erase transcript", () => {
	let events: any;
	const received: any[] = [];
	const connect = runInNewContext(LAN_VOICE_BROWSER_EVENTS_SCRIPT + "; connectBrowserEvents", {
		EventSource: class { constructor() { events=this; } },
	});
	const state = {textContent:""};
	connect({clientId:"test",connection:{classList:{add(){},remove(){}},lastElementChild:{}},activityState:state,transcript:{handle:(e:any)=>received.push(e)},composer:{applyDraft(){},markSent(){}},audio:{handleServerCommand(){}}});
	events.onmessage({data:JSON.stringify({type:"activity",state:"working"})}); assert.equal(state.textContent,"Working…");
	events.onmessage({data:JSON.stringify({type:"activity",state:"settled",text:"old text"})}); assert.equal(state.textContent,"");
	assert.equal(received.length,2);
});

test("finalized voice callbacks mirror user/assistant once, never delegation or context tail", async () => {
	const visible:string[]=[];
	const messages=new CodexVoiceSessionMessages({appendEntry(){},sendMessage(){}} as never, {
		canDelegate:()=>false,prepareDelegation:async()=>undefined,onDelegation(){},onDelegationFailed(){},onWorking(){},
		onUserTranscript:t=>visible.push('user:'+t),onAssistantTranscript:t=>visible.push('assistant:'+t),
	});
	messages.userTranscript('question');
	await messages.voiceTurn({input:'answer'});
	await messages.voiceTurn({input:'question',delegationId:'delegate-1',transcriptDelta:'PRIVATE HISTORY'});
	messages.retainTranscriptTail('PRIVATE TAIL');
	messages.contextSummary('PRIVATE SUMMARY');
	assert.deepEqual(visible,['user:question','assistant:answer']);
});

test("production HTML has real controls, compact history and no fixture / unsafe text rendering", () => {
	const html = createLanVoiceWebUi(theme as never);
	for (const id of ["voice","mute","draft","send","history","messages","bottom","older"]) assert.match(html,new RegExp(`id="${id}"`));
	assert.match(html,/text\.textContent = m.text/);
	assert.doesNotMatch(html,/fixture|innerHTML|id="activity-text"/);
	assert.match(html,/getUserMedia/); assert.match(html,/\/api\/send/);
	assert.match(html,/min-height:44px/);
});

test("real HTTPS/SSE emits live records, no history endpoint or replay, clears epoch", {timeout:10000}, async () => {
	const dir=await mkdtemp(join(tmpdir(),"voice-transcript-test-"));
	let lanCurrent=true;
	const sent:string[]=[]; let finalize:(role:"user"|"assistant",text:string)=>void=()=>{};
	const server=await startCodexLanVoiceServer({
		ctx:{isIdle:()=>true,sessionManager:{getSessionId:()=>"owner"},ui:{theme}} as never,
		voice:{onInputMuteChange:()=>()=>{},onTranscript:(fn:typeof finalize)=>{finalize=fn;return ()=>{};},startRealtimeWithPeer:async()=>({}),isCurrentConversation:()=>lanCurrent,setConversationInputActive(){},stopConversation:async()=>{}} as never,
		getConfig:()=>({}) as never,resolveAuth:async()=>{throw new Error("NO PAID VOICE IN TESTS");},
		sendUserMessage:t=>sent.push(t),ownerSessionId:"owner",port:0,certificateAgentDir:dir,
	});
	const url=new URL(server.urls[0]!);url.hostname="127.0.0.1";
	const open=()=>new Promise<{events:any[];close():void;wait(type:string):Promise<any>}>((resolve,reject)=>{
		const events:any[]=[];const waiters:Array<{type:string;resolve:(value:any)=>void}>=[];
		const req=request(new URL('/api/events?client='+Math.random(),url),{rejectUnauthorized:false},res=>{
			let pending="";res.setEncoding("utf8");
			res.on("data",chunk=>{pending+=chunk;let idx;while((idx=pending.indexOf("\n\n"))>=0){const frame=pending.slice(0,idx);pending=pending.slice(idx+2);if(!frame.startsWith("data: "))continue;const event=JSON.parse(frame.slice(6));events.push(event);for(const w of [...waiters])if(w.type===event.type){waiters.splice(waiters.indexOf(w),1);w.resolve(event);}}});
			resolve({events,close:()=>req.destroy(),wait:type=>events.some(e=>e.type===type)?Promise.resolve(events.find(e=>e.type===type)):new Promise(resolve=>waiters.push({type,resolve}))});
		});req.on("error",reject);req.end();
	});
	const http=(path:string,body?:unknown)=>new Promise<{status:number;body:string}>((resolve,reject)=>{
		const req=request(new URL(path,url),{method:body?"POST":"GET",rejectUnauthorized:false,headers:{"content-type":"application/json"}},res=>{let text="";res.on("data",c=>text+=c);res.on("end",()=>resolve({status:res.statusCode!,body:text}));});req.on("error",reject);req.end(body?JSON.stringify(body):undefined);
	});
	const streams:Array<{close():void}>=[];
	try{
		server.assistantStarted();server.assistantText([{type:"text",text:"before connect SECRET"}],true);server.agentSettled();
		const first=await open();streams.push(first);await first.wait("mute");
		assert.doesNotMatch(JSON.stringify(first.events),/SECRET/);
		const epoch=first.events.find(e=>e.type==="transcript.epoch").epoch;
		server.assistantStarted();server.assistantText([{type:"text",text:"live"}],false);
		const record=await first.wait("transcript.message");assert.equal(record.message.text,"live");
		const second=await open();streams.push(second);await second.wait("mute");assert.equal(second.events.some(e=>e.type==="transcript.message"),false);
		assert.equal((await http('/api/history')).status,404);
		const response=await http('/api/send',{clientId:"test",text:"user draft",revision:0});assert.equal(response.status,200);assert.deepEqual(sent,["user draft"]);
		// A desktop/non-LAN finalized transcript must not appear in this LAN.
		finalize("user", "desktop SECRET");
		server.resetTranscript();
		await http('/api/history');
		assert.notEqual(first.events.filter(e=>e.type==="transcript.epoch").at(-1).epoch,epoch);
		assert.doesNotMatch(JSON.stringify(first.events),/desktop SECRET/);
		assert.equal(first.events.filter(e=>e.type==="transcript.message"&&e.message.role==="user").length,1);
		const audioURL=new URL('/api/audio?client=fake-audio',url);audioURL.protocol='wss:';
		const socket=new WebSocket(audioURL,{rejectUnauthorized:false});
		try {
			await new Promise<void>((resolve,reject)=>{socket.on('open',()=>socket.send(JSON.stringify({type:'start',mode:'conversation'})));socket.on('message',data=>{if(JSON.parse(String(data)).type==='active')resolve();});socket.on('error',reject);});
			finalize('user','finalized LAN question');finalize('assistant','finalized LAN answer');
			await http('/api/history');
			assert.equal(first.events.filter(e=>e.message?.text==='finalized LAN question').length,1);
			assert.equal(first.events.filter(e=>e.message?.text==='finalized LAN answer').length,1);
			lanCurrent=false; finalize('user','replaced by desktop SECRET');
			await http('/api/history');
			assert.doesNotMatch(JSON.stringify(first.events),/desktop SECRET/);
		} finally {socket.terminate();}
	}finally{for(const stream of streams)stream.close();await server.close();await rm(dir,{recursive:true,force:true});}
});
