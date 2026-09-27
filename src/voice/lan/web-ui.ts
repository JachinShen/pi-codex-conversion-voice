import type { Theme } from "@earendil-works/pi-coding-agent";
import { LAN_VOICE_BROWSER_SCRIPT } from "./browser-script.ts";
import { resolveLanVoiceWebTheme } from "./theme.ts";

export function createLanVoiceWebUi(piTheme: Theme): string {
	const theme = resolveLanVoiceWebTheme(piTheme);
	return String.raw`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="${theme.pageColor}">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="GipPity">
<link rel="icon" href="/favicon.svg?v=2" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png?v=2">
<link rel="manifest" href="/manifest.webmanifest">
<title>GipPity 对话</title>
<style>
:root{${theme.variables};color-scheme:${theme.colorScheme};font:15px/1.45 system-ui;background:var(--pi-user-message-bg);color:var(--pi-text)}
*{box-sizing:border-box}body{margin:0}#app{height:100dvh;max-width:900px;margin:auto;display:flex;flex-direction:column;padding:env(safe-area-inset-top) max(8px,env(safe-area-inset-right)) env(safe-area-inset-bottom) max(8px,env(safe-area-inset-left));position:relative}
header{display:flex;align-items:center;gap:6px;min-height:48px;border-bottom:1px solid var(--pi-border-muted)}header strong{font-size:16px;white-space:nowrap}.connection{flex:1;font-size:12px;color:var(--pi-muted)}.connection.online{color:var(--pi-success)}
button{font:inherit;font-size:14px;min-width:44px;min-height:44px;color:inherit;background:var(--pi-selected-bg);border:1px solid var(--pi-border-muted);border-radius:10px;padding:6px 10px;cursor:pointer}button:disabled{opacity:.55;cursor:default}[hidden]{display:none!important}
#voice[aria-pressed="true"]{color:var(--pi-warning)}#voice .stop-label{display:none}#voice[aria-pressed="true"] .start-label{display:none}#voice[aria-pressed="true"] .stop-label{display:inline}#voice[aria-busy="true"]{opacity:.6}#mute[aria-pressed="true"]{color:var(--pi-warning)}#mute{font-size:12px;padding:6px}
#history{flex:1;min-height:0;overflow:auto;overflow-anchor:none;overscroll-behavior:contain;padding:8px 0}#older{display:block;margin:0 auto 8px}article{padding:7px 10px;margin:0 0 6px;max-width:89%;border-radius:12px;background:var(--pi-tool-pending-bg);overflow-wrap:anywhere}article.user{margin-left:auto;background:var(--pi-selected-bg)}article small{color:var(--pi-muted);font-size:12px}p{margin:0;white-space:pre-wrap}
.composer{display:flex;gap:6px;padding:6px 0;border-top:1px solid var(--pi-border-muted)}textarea{resize:none;flex:1;min-width:0;font:inherit;font-size:16px;color:inherit;background:var(--pi-tool-pending-bg);border:1px solid var(--pi-border-muted);border-radius:10px;padding:10px;height:44px}button:focus-visible,textarea:focus{outline:2px solid var(--pi-accent)}#bottom{position:absolute;bottom:calc(76px + env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);white-space:nowrap;background:var(--pi-selected-bg);box-shadow:0 2px 15px #0006}
.status-line{display:flex;gap:8px;flex-wrap:wrap;font-size:11px;color:var(--pi-muted);padding:2px 0}.status-line p:empty{display:none}#history-note{color:var(--pi-muted);font-size:12px;text-align:center;padding:12px}.modes{display:flex;gap:4px}.modes button{font-size:12px}.modes [aria-pressed="true"]{color:var(--pi-accent)}details{font-size:12px}summary{min-width:44px;min-height:44px;display:flex;align-items:center;cursor:pointer}details[open]{position:absolute;right:8px;top:48px;z-index:2;padding:8px;border:1px solid var(--pi-border-muted);background:var(--pi-user-message-bg);border-radius:10px}details[open] summary{justify-content:flex-end}@media(min-width:700px){article{max-width:75%}}
</style>
</head>
<body><div id="app">
<header><strong>对话</strong><div id="connection" class="connection" role="status"><span>Connecting</span></div>
<button id="mute" type="button" aria-pressed="false" aria-label="Mute microphone" hidden><span>Mute mic</span></button>
<button id="voice" type="button" data-mode="conversation" aria-busy="false" aria-pressed="false" aria-label="Start voice"><span class="start-label">连接</span><span class="stop-label">结束</span></button>
<details><summary aria-label="音频设置">⋯</summary><nav class="modes" aria-label="Input mode"><button type="button" data-mode="conversation" aria-pressed="true">Voice</button><button type="button" data-mode="dictation" aria-pressed="false">Dictate</button></nav><p>仅保留本页收到的最近 30 条消息；刷新清空，不加载旧会话。</p></details></header>
<div class="status-line" aria-live="polite"><p id="audio-state">Tap to start voice</p><p id="audio-detail"></p><p id="activity-state"></p></div>
<main id="history" tabindex="0" aria-label="聊天记录"><button id="older" type="button" hidden>加载更早消息</button><p id="history-note">连接后在此积累消息 · 不加载旧会话</p><div id="messages"></div></main>
<button id="bottom" type="button" hidden>回到底部</button>
<div class="composer"><textarea id="draft" rows="1" aria-label="文字消息" placeholder="输入消息"></textarea><button id="send" type="button" disabled>Send</button></div><p id="composer-status" class="status-line" aria-live="polite"></p>
</div><script>${LAN_VOICE_BROWSER_SCRIPT}</script></body></html>`;
}
