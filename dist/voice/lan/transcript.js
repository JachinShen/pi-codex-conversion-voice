import { randomUUID } from "node:crypto";
import { boundedAssistantText } from "./activity.js";
// Live-only projection. Never reads SessionManager or replays records to a new connection.
export class LanVoiceTranscript {
    epoch = randomUUID();
    seq = 0;
    current;
    publish;
    constructor(publish) { this.publish = publish; }
    identity() {
        return { type: "transcript.epoch", epoch: this.epoch };
    }
    reset() {
        this.epoch = randomUUID();
        this.seq = 0;
        this.current = undefined;
        this.publish(this.identity());
    }
    assistantStart() { this.current = undefined; }
    assistant(parts, final) {
        const text = boundedAssistantText(parts);
        if (!text && !this.current)
            return;
        this.current ??= { messageId: randomUUID(), seq: ++this.seq, revision: 0 };
        this.publish({ type: "transcript.message", epoch: this.epoch, message: {
                ...this.current, revision: ++this.current.revision, role: "assistant", source: "pi",
                status: final ? "final" : "streaming", text: text ?? "",
            } });
        if (final)
            this.current = undefined;
    }
    finalized(text, role, source) {
        const bounded = boundedAssistantText([{ type: "text", text }]);
        if (!bounded)
            return;
        this.publish({ type: "transcript.message", epoch: this.epoch, message: {
                messageId: randomUUID(), seq: ++this.seq, revision: 1, role, source, status: "final", text: bounded,
            } });
    }
}
