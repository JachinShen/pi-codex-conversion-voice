import { resolveCodexVoiceAuth } from "../auth.js";
export class CodexLanVoiceServerController {
    voice;
    getConfig;
    sendUserMessage;
    agentDir;
    server;
    operation = Promise.resolve();
    constructor(voice, getConfig, sendUserMessage, agentDir) {
        this.voice = voice;
        this.getConfig = getConfig;
        this.sendUserMessage = sendUserMessage;
        this.agentDir = agentDir;
    }
    status() {
        return { running: Boolean(this.server), urls: this.server?.urls ?? [] };
    }
    setEnabled(enabled, ctx) {
        return this.enqueue(async () => {
            if (!enabled) {
                await this.stopCurrent(ctx);
                return this.status();
            }
            const sessionId = ctx.sessionManager.getSessionId();
            if (this.server?.ownerSessionId === sessionId)
                return this.status();
            await this.stopCurrent(ctx);
            const { startCodexLanVoiceServer } = await import("./server.js");
            this.server = await startCodexLanVoiceServer({
                ctx,
                getConfig: this.getConfig,
                voice: this.voice,
                resolveAuth: () => resolveCodexVoiceAuth(ctx),
                sendUserMessage: (text) => this.sendUserMessage(text, ctx),
                ownerSessionId: sessionId,
                certificateAgentDir: this.agentDir,
            });
            ctx.ui.setStatus("codex-lan-voice", ctx.ui.theme.fg("accent", "voice LAN: on"));
            ctx.ui.notify(`LAN voice is running:\n${this.server.urls.join("\n")}\nAccept the local certificate on first visit.`, "info");
            return this.status();
        });
    }
    stop(ctx) {
        return this.enqueue(() => this.stopCurrent(ctx));
    }
    agentStarted() {
        if (!this.server)
            return;
        this.server.agentStarted();
    }
    assistantStarted() { this.server?.assistantStarted(); }
    assistantUpdate(message) { this.server?.assistantText(message.content, false); }
    resetTranscript() {
        this.server?.resetTranscript();
    }
    assistantMessage(message) {
        if (!this.server)
            return;
        this.server.assistantText(message.content, true);
    }
    agentSettled() {
        if (!this.server)
            return;
        this.server.agentSettled();
    }
    async stopCurrent(ctx) {
        const server = this.server;
        this.server = undefined;
        ctx?.ui.setStatus("codex-lan-voice", undefined);
        await server?.close();
    }
    enqueue(action) {
        const result = this.operation.then(action, action);
        this.operation = result.then(() => undefined, () => undefined);
        return result;
    }
}
