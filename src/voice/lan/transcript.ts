import { randomUUID } from "node:crypto";
import { boundedAssistantText } from "./activity.ts";

// Live-only projection. Never reads SessionManager or replays records to a new connection.
export class LanVoiceTranscript {
	private epoch = randomUUID();
	private seq = 0;
	private current: { messageId: string; seq: number; revision: number } | undefined;
	private readonly publish: (event: unknown) => void;
	constructor(publish: (event: unknown) => void) { this.publish = publish; }
	identity(): { type: "transcript.epoch"; epoch: string } {
		return { type: "transcript.epoch", epoch: this.epoch };
	}
	reset(): void {
		this.epoch = randomUUID(); this.seq = 0; this.current = undefined;
		this.publish(this.identity());
	}
	assistantStart(): void { this.current = undefined; }
	assistant(parts: Array<{ type: string; text?: string | undefined }>, final: boolean): void {
		const text = boundedAssistantText(parts);
		if (!text && !this.current) return;
		this.current ??= { messageId: randomUUID(), seq: ++this.seq, revision: 0 };
		this.publish({ type: "transcript.message", epoch: this.epoch, message: {
			...this.current, revision: ++this.current.revision, role: "assistant", source: "pi",
			status: final ? "final" : "streaming", text: text ?? "",
		} });
		if (final) this.current = undefined;
	}
	finalized(text: string, role: "user" | "assistant", source: "text" | "voice"): void {
		const bounded = boundedAssistantText([{ type: "text", text }]);
		if (!bounded) return;
		this.publish({ type: "transcript.message", epoch: this.epoch, message: {
			messageId: randomUUID(), seq: ++this.seq, revision: 1, role, source, status: "final", text: bounded,
		} });
	}
}
