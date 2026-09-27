import { startControllerMode, } from "./controller-start.js";
import { currentVoiceSession, prepareRealtimeVoicePrompt, renderVoiceStatus, VOICE_STATUS_KEY, voiceModeForState, } from "./controller-support.js";
import { realtimeHandoffChannel } from "./conversation/handoff.js";
import { CodexVoiceSessionMessages } from "./session-messages.js";
import { formatVoiceAudioError } from "./setup.js";
export class CodexVoiceController {
    runtime = {
        state: { type: "idle" },
        startGeneration: 0,
        voiceStatus: "",
    };
    messages;
    inputMuteListeners = new Set();
    delegationPreflight = async () => undefined;
    constructor(pi) {
        this.messages = new CodexVoiceSessionMessages(pi, {
            canDelegate: () => this.runtime.state.type === "conversation",
            prepareDelegation: (ctx, signal) => this.delegationPreflight(ctx, signal),
            onDelegation: (id) => {
                if (this.runtime.state.type === "conversation")
                    this.runtime.state.session.activateDelegation(id);
            },
            onDelegationFailed: () => {
                if (this.runtime.state.type === "conversation")
                    this.runtime.state.session.settleAgentTurn();
            },
            onWorking: () => this.renderStatus("working"),
        });
    }
    setDelegationPreflight(preflight) {
        this.delegationPreflight = preflight;
    }
    get status() {
        return this.runtime.state.type;
    }
    get active() {
        return (this.runtime.state.type !== "idle" && this.runtime.state.type !== "failed");
    }
    get activeMode() {
        return this.runtime.announcedMode;
    }
    get inputMuted() {
        return (this.runtime.state.type === "conversation" &&
            this.runtime.state.session.microphoneMuted);
    }
    onInputMuteChange(listener) {
        this.inputMuteListeners.add(listener);
        return () => this.inputMuteListeners.delete(listener);
    }
    setInputMuted(muted) {
        if (this.runtime.state.type !== "conversation" ||
            this.runtime.announcedMode !== "realtime")
            return false;
        const previous = this.runtime.state.session.microphoneMuted;
        this.runtime.state.session.setInputMuted(muted);
        const current = this.runtime.state.session.microphoneMuted;
        if (previous !== current) {
            this.renderCurrentStatus();
            for (const listener of this.inputMuteListeners)
                listener(current);
        }
        return true;
    }
    resetContextAnnouncements() {
        this.messages.resetContextAnnouncements();
    }
    resetSessionContext() {
        this.messages.resetSessionContext();
    }
    announceDictation(ctx) {
        this.messages.setContext(ctx);
        this.messages.modeStarted("dictation");
    }
    async start(ctx, config, mode) {
        await this.startMode(ctx, config, mode);
    }
    async startRealtimeWithPeer(ctx, config, peer, signal) {
        return this.startMode(ctx, config, "realtime", peer, signal);
    }
    prepareRealtimePrompt(ctx) {
        return prepareRealtimeVoicePrompt(ctx);
    }
    async stopConversation(session, options) {
        if (this.currentSession() === session)
            await this.stop(options);
    }
    setConversationInputActive(session, active) {
        if (this.currentSession() !== session)
            return;
        if (active) {
            if (this.runtime.announcedMode === "realtime")
                return;
            this.runtime.announcedMode = "realtime";
            this.messages.modeStarted("realtime");
            return;
        }
        if (session.microphoneMuted)
            this.setInputMuted(false);
        if (this.runtime.announcedMode !== "realtime")
            return;
        this.runtime.announcedMode = undefined;
        this.messages.conversationInputStopped();
    }
    async startMode(ctx, config, mode, peer, signal) {
        return startControllerMode({
            runtime: this.runtime,
            messages: this.messages,
            ctx,
            config,
            mode,
            peer,
            signal,
            prepareRealtimePrompt: (current) => this.prepareRealtimePrompt(current),
            stopCurrent: () => this.stop({ announce: true }),
            finishCurrentDictation: () => this.finishDictation({ announce: true }),
            onError: (error) => this.fail(error),
            onStatus: (status) => this.renderStatus(status),
        });
    }
    async stop(options) {
        this.runtime.startAbortController?.abort();
        this.runtime.startAbortController = undefined;
        this.runtime.startGeneration += 1;
        const stopGeneration = this.runtime.startGeneration;
        const wasMuted = this.inputMuted;
        const endedMode = options?.announce
            ? this.runtime.announcedMode
            : undefined;
        const session = this.currentSession();
        const closePromise = session?.close();
        this.runtime.state = { type: "idle" };
        this.runtime.announcedMode = undefined;
        this.runtime.config = undefined;
        this.runtime.voiceStatus = "";
        this.runtime.context?.ui.setStatus(VOICE_STATUS_KEY, undefined);
        await closePromise;
        this.messages.cancelPendingDelegations();
        await this.messages.waitForDelegations();
        if (wasMuted)
            for (const listener of this.inputMuteListeners)
                listener(false);
        if (this.runtime.startGeneration === stopGeneration)
            this.messages.voiceStopped(endedMode);
    }
    async finishDictation(options) {
        this.runtime.startGeneration += 1;
        const session = this.runtime.state.type === "dictation"
            ? this.runtime.state.session
            : this.runtime.state.type === "connecting" &&
                this.runtime.state.mode === "dictation" &&
                this.runtime.state.phase === "starting"
                ? this.runtime.state.session
                : undefined;
        if (!session) {
            await this.stop(options);
            return;
        }
        await session.finish();
        if (this.currentSession() !== session)
            return;
        const endedMode = options?.announce
            ? this.runtime.announcedMode
            : undefined;
        this.runtime.state = { type: "idle" };
        this.runtime.announcedMode = undefined;
        this.runtime.config = undefined;
        this.runtime.voiceStatus = "";
        this.runtime.context?.ui.setStatus(VOICE_STATUS_KEY, undefined);
        this.messages.voiceStopped(endedMode);
    }
    agentStarted() {
        this.messages.agentStarted();
    }
    filterContext(messages) {
        return this.messages.filterContext(messages);
    }
    mirrorPiSteer(input) {
        return (this.runtime.state.type === "conversation" &&
            this.runtime.state.session.mirrorPiSteer(input));
    }
    streamDelta(delta) {
        if (this.runtime.state.type === "conversation")
            this.runtime.state.session.streamAgentDelta(delta);
    }
    finishAgentMessage(stopReason) {
        if (this.runtime.state.type === "conversation")
            this.runtime.state.session.finishAgentMessage(realtimeHandoffChannel(stopReason));
    }
    settleTurn() {
        if (this.runtime.state.type === "conversation")
            this.runtime.state.session.settleAgentTurn();
        this.messages.agentSettled();
    }
    currentSession() {
        return currentVoiceSession(this.runtime.state);
    }
    fail(error) {
        if (this.runtime.state.type === "idle" ||
            this.runtime.state.type === "failed")
            return;
        this.runtime.startAbortController?.abort();
        this.runtime.startAbortController = undefined;
        const mode = voiceModeForState(this.runtime.state);
        const message = this.runtime.config
            ? formatVoiceAudioError(error, mode, this.runtime.config)
            : error.message;
        const failGeneration = ++this.runtime.startGeneration;
        const endedMode = this.runtime.announcedMode;
        const wasMuted = this.inputMuted;
        const session = this.currentSession();
        const closePromise = session?.close();
        this.runtime.state = { type: "failed", message };
        this.runtime.announcedMode = undefined;
        this.runtime.config = undefined;
        this.runtime.voiceStatus = "";
        this.runtime.context?.ui.setStatus(VOICE_STATUS_KEY, undefined);
        this.runtime.context?.ui.notify(message, "error");
        if (wasMuted)
            for (const listener of this.inputMuteListeners)
                listener(false);
        void (async () => {
            await Promise.allSettled([closePromise]);
            this.messages.cancelPendingDelegations();
            await Promise.allSettled([this.messages.waitForDelegations()]);
            if (this.runtime.startGeneration === failGeneration &&
                this.runtime.state.type === "failed" &&
                this.runtime.state.message === message)
                this.messages.voiceStopped(endedMode);
        })();
    }
    renderStatus(status) {
        this.runtime.voiceStatus = status;
        this.renderCurrentStatus();
    }
    renderCurrentStatus() {
        renderVoiceStatus(this.runtime.context, this.runtime.voiceStatus, this.inputMuted);
    }
}
