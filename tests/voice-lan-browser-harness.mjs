// Manual CDP fixture: real production HTTP/UI/composer/SSE, loopback only.
// No upstream credentials, no audio handshake, no model or microphone use.
import { createServer } from 'node:http';
import { handleLanVoiceHttpRequest } from '../dist/voice/lan/http-handler.js';
import { createLanVoiceWebUi } from '../dist/voice/lan/web-ui.js';
import { LanVoiceActivity } from '../dist/voice/lan/activity.js';
import { LanVoiceTranscript } from '../dist/voice/lan/transcript.js';
import { LanVoiceDraft } from '../dist/voice/lan/draft.js';
import { LanVoiceBrowserClients } from '../dist/voice/lan/browser-clients.js';
const forbidden = () => { throw new Error('Audio is forbidden in this test harness'); };
const clients = new LanVoiceBrowserClients({ensureConversation:forbidden,startDictation:forbidden,finishDictation:forbidden,cancelDictation:async()=>{},onConversationActivity(){},onConversationMute(){},conversationMuted:()=>false,onConversationAudio:forbidden,onDictationAudio:forbidden});
const activity = new LanVoiceActivity({initialWorking:false,publish:e=>clients.broadcastControl(e)});
const transcript = new LanVoiceTranscript(e=>clients.broadcastControl(e));
const sent=[];
const draft = new LanVoiceDraft({publish:e=>clients.broadcastControl(e),sendMessage:text=>{sent.push(text);transcript.finalized(text,'user','text');}});
const theme = {getFgAnsi:name=>'\x1b[38;2;'+({accent:'104;181;232',muted:'168;183;202',borderMuted:'42;55;73',success:'115;201;145'}[name]||'225;232;244')+'m',getBgAnsi:name=>'\x1b[48;2;'+({selectedBg:'32;57;74',toolPendingBg:'28;38;53'}[name]||'16;21;30')+'m'};
const server=createServer(async(req,res)=>{
  if(req.url==='/test/emit'&&req.method==='POST'){
    let data=''; for await (const chunk of req) data+=chunk;
    const event=JSON.parse(data);
    if(event.action==='reset') transcript.reset();
    if(event.action==='start') transcript.assistantStart();
    if(event.action==='assistant') transcript.assistant([{type:'text',text:event.text}],event.final===true);
    if(event.action==='user') transcript.finalized(event.text,'user','voice');
    if(event.action==='working') activity.working();
    if(event.action==='settled') activity.settled();
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({sent}));return;
  }
  await handleLanVoiceHttpRequest(req,res,{activity,transcript,clients,draft,renderManifest:()=> '{}',renderPage:()=>createLanVoiceWebUi(theme),inputMuted:()=>false,ownerIsActive:()=>true,closing:false});
});
server.listen(0,'127.0.0.1',()=>console.log('TEST_URL=http://127.0.0.1:'+server.address().port));
