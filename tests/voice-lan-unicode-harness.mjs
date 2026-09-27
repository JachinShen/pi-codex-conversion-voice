// Isolated production HTML fixture. Never contacts a real voice server.
// Run from the repository root; open http://127.0.0.1:43129 in an isolated browser.
import {createServer} from 'node:http';
import {build} from 'esbuild';
const {outputFiles}=await build({entryPoints:['src/voice/lan/web-ui.ts'],bundle:true,platform:'node',format:'esm',charset:'ascii',write:false});
const {createLanVoiceWebUi}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));
const html=createLanVoiceWebUi({getFgAnsi:()=> '\x1b[39m',getBgAnsi:()=> '\x1b[49m'});
const guard=`<script>
window.__events=[];
window.EventSource=class { constructor(){window.__events.push(this)} close(){} };
window.fetch=()=>{throw Error('Network forbidden')};
window.WebSocket=class {constructor(){throw Error('Audio forbidden')}};
navigator.mediaDevices.getUserMedia=()=>{throw Error('Microphone forbidden')};
</script>`;
createServer((req,res)=>{if(req.url!=='/'){res.writeHead(404);res.end();return;}res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html.replace('<script>',guard+'<script>'));}).listen(43129,'127.0.0.1');
