import { isVoiceContextExcludedMessage } from "./context-visibility.js";
import { renderRealtimeTranscriptTail } from "./prompts.js";
import { CODEX_VOICE_MODE_MESSAGE_TYPE, codexVoiceModeMessage, REALTIME_DELEGATION_MESSAGE_TYPE, REALTIME_USER_TRANSCRIPT_MESSAGE_TYPE, REALTIME_VOICE_MESSAGE_TYPE, realtimeVoiceMessage, VOICE_CONTEXT_MESSAGE_TYPE, } from "./ui.js";
const REALTIME_VOICE_TAIL_CONTEXT_TYPE = "codex-realtime-voice-tail";
export class CodexVoiceSessionMessages {
    pi;
    callbacks;
    context;
    piTurnActive = false;
    dictationAnnounced = false;
    delegationTail = Promise.resolve();
    delegationAbortController = new AbortController();
    contextGeneration = 0;
    constructor(pi, callbacks) {
        this.pi = pi;
        this.callbacks = callbacks;
    }
    setContext(ctx) {
        this.replaceContext(ctx);
        this.piTurnActive = !ctx.isIdle();
    }
    contextSummary(summary) {
        this.pi.appendEntry(VOICE_CONTEXT_MESSAGE_TYPE, { summary });
    }
    userTranscript(transcript) {
        this.pi.appendEntry(REALTIME_USER_TRANSCRIPT_MESSAGE_TYPE, { transcript });
        this.callbacks.onUserTranscript?.(transcript);
    }
    modeStarted(mode) {
        if (mode === "dictation") {
            if (this.dictationAnnounced)
                return;
            this.dictationAnnounced = true;
        }
        this.appendMode(mode, "started");
    }
    resetContextAnnouncements() {
        this.dictationAnnounced = false;
    }
    resetSessionContext() {
        this.replaceContext(undefined);
        this.piTurnActive = false;
    }
    conversationInputStopped() {
        this.appendMode("realtime", "ended");
    }
    voiceStopped(mode) {
        this.piTurnActive = this.context ? !this.context.isIdle() : false;
        if (mode && mode !== "dictation")
            this.appendMode(mode, "ended");
        this.replaceContext(undefined);
    }
    voiceTurn(turn) {
        if (!turn.delegationId) {
            this.pi.appendEntry(REALTIME_VOICE_MESSAGE_TYPE, {
                input: turn.input,
                route: "conversation",
            });
            this.callbacks.onAssistantTranscript?.(turn.input);
            return Promise.resolve();
        }
        const generation = this.contextGeneration;
        const canDeliver = this.callbacks.canDelegate();
        const delivery = this.delegationTail.then(() => this.deliverDelegation(turn, generation, canDeliver));
        this.delegationTail = delivery.catch(() => undefined);
        return delivery;
    }
    waitForDelegations() {
        return this.delegationTail;
    }
    cancelPendingDelegations() {
        this.delegationAbortController.abort();
    }
    retainTranscriptTail(transcriptDelta) {
        const piTurnActive = this.piTurnActive || (this.context ? !this.context.isIdle() : false);
        this.pi.sendMessage({
            customType: REALTIME_VOICE_TAIL_CONTEXT_TYPE,
            content: renderRealtimeTranscriptTail(transcriptDelta),
            display: false,
            details: {},
        }, {
            triggerTurn: false,
            deliverAs: piTurnActive ? "nextTurn" : "steer",
        });
    }
    filterContext(messages) {
        return messages.filter((message) => !isVoiceContextExcludedMessage(message));
    }
    agentStarted() {
        this.piTurnActive = true;
    }
    agentSettled() {
        this.piTurnActive = false;
    }
    appendMode(mode, state) {
        if (mode === "realtime") {
            this.pi.sendMessage(codexVoiceModeMessage(mode, state), {
                triggerTurn: false,
                deliverAs: "steer",
            });
            return;
        }
        this.pi.appendEntry(CODEX_VOICE_MODE_MESSAGE_TYPE, { mode, state });
    }
    replaceContext(ctx) {
        this.delegationAbortController.abort();
        this.delegationAbortController = new AbortController();
        this.contextGeneration++;
        this.delegationTail = Promise.resolve();
        this.context = ctx;
    }
    async deliverDelegation(turn, generation, canDeliver) {
        const ctx = this.context;
        if (generation !== this.contextGeneration ||
            !ctx ||
            !turn.delegationId ||
            !canDeliver)
            return;
        const signal = this.delegationAbortController.signal;
        let preflight;
        let deliveryStarted = false;
        let failureAction = "prepare";
        try {
            let startsTurn = !this.piTurnActive && ctx.isIdle();
            if (startsTurn) {
                for (;;) {
                    preflight = await this.callbacks.prepareDelegation(ctx, signal);
                    if (generation !== this.contextGeneration ||
                        this.context !== ctx)
                        return;
                    startsTurn = !this.piTurnActive && ctx.isIdle();
                    if (!startsTurn)
                        break;
                    deliveryStarted = true;
                    if (preflight?.commit() !== false)
                        break;
                    deliveryStarted = false;
                    preflight = undefined;
                }
            }
            failureAction = "deliver";
            deliveryStarted = true;
            this.callbacks.onDelegation(turn.delegationId);
            this.piTurnActive = true;
            this.callbacks.onWorking();
            this.pi.sendMessage(realtimeVoiceMessage(turn.input, "delegation", turn.transcriptDelta), startsTurn
                ? { triggerTurn: true }
                : { triggerTurn: true, deliverAs: "steer" });
        }
        catch (error) {
            if (generation !== this.contextGeneration ||
                this.context !== ctx)
                return;
            if (deliveryStarted) {
                try {
                    preflight?.rollback();
                }
                catch { }
                try {
                    this.piTurnActive = this.context ? !this.context.isIdle() : false;
                }
                catch {
                    this.piTurnActive = false;
                }
                try {
                    this.callbacks.onDelegationFailed(turn.delegationId);
                }
                catch { }
            }
            const message = signal.aborted
                ? "Voice session stopped before the delegation was prepared"
                : error instanceof Error ? error.message : String(error);
            if (!signal.aborted) {
                try {
                    ctx.ui.notify(`Could not ${failureAction} voice delegation: ${message}`, "error");
                }
                catch { }
            }
            try {
                this.pi.appendEntry(REALTIME_DELEGATION_MESSAGE_TYPE, { input: turn.input, route: "delegation", error: message });
            }
            catch { }
        }
    }
}
