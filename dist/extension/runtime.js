import { buildSessionContext, convertToLlm } from "@earendil-works/pi-coding-agent";
import { dirname } from "node:path";
import { getCodexConversionConfigPath, readCodexConversionConfig } from "../adapter/activation/config-store.js";
import { isAdapterRuntime, resolveCodexRuntimePlan } from "../adapter/activation/runtime-plan.js";
import { rewriteCodexPrewarmProviderRequest, rewriteCodexProviderRequest } from "../adapter/provider-request.js";
import { getDefaultCodexRuntimeShell } from "../adapter/prompt/runtime-shell.js";
import { isProviderContextExcludedMessage } from "../adapter/prompt/context-filter.js";
import { buildCodexSystemPrompt } from "../prompt/build-system-prompt.js";
import { closeOpenAICodexWebSocketSessions, prewarmOpenAICodexWebSocket } from "../providers/openai-codex-custom-provider.js";
import { resetOpenAICodexWebSocketSessions } from "../providers/openai-codex/websocket.js";
import { createCodexTurnState } from "../providers/openai-codex/turn-state.js";
import { createExecCommandTracker } from "../tools/exec/command-state.js";
import { createExecSessionManager } from "../tools/exec/session-manager.js";
import { getBundledToolBinaryPath } from "../tools/native/binary.js";
import { CodexVoiceController } from "../voice/controller.js";
import { CodexLanVoiceServerController } from "../voice/lan/controller.js";
import { getActiveToolsInActiveOrder } from "../adapter/active-tools.js";
import { createLazyCodexDiagnostics } from "../diagnostics/lazy.js";
function activeToolContext(pi) {
    // Pi ToolInfo omits constrainedSampling; restore our owned exec contract so
    // prewarm and the real Code Mode turn serialize the same provider tools.
    return getActiveToolsInActiveOrder(pi, true);
}
function prewarmReasoningOption(level) {
    return level === "off" ? {} : { reasoning: level };
}
export function createCodexExtensionRuntime(pi) {
    const state = {
        enabled: false,
        cwd: process.cwd(),
        promptSkills: [],
        config: readCodexConversionConfig(),
        codexTurnState: createCodexTurnState(),
    };
    const tracker = createExecCommandTracker();
    const sessions = createExecSessionManager({
        env: { ...process.env, PI_CODEX_MODEL: state.config.openai.webSearchModel },
        bridgeBinaryPath: () => getBundledToolBinaryPath("exec_bridge", {}, state.config.tools.customRustBinariesDir),
    });
    let prewarmController;
    let prewarmPromise;
    let pendingPrewarmKey;
    let prewarmedKey;
    const voice = new CodexVoiceController(pi);
    const diagnostics = createLazyCodexDiagnostics();
    const buildPrewarmPlan = (ctx, systemPrompt, prepared, messages, rewriteCompactedReplay) => {
        const model = ctx.model;
        const config = structuredClone(state.config);
        if (!model || model.provider !== "openai-codex" || !isAdapterRuntime(resolveCodexRuntimePlan(ctx, config)) || !config.openai.forceCachedWebSockets)
            return undefined;
        const preparedSystemPrompt = prepared
            ? systemPrompt
            : runtime.codexSystemPrompt(systemPrompt, ctx);
        const tools = activeToolContext(pi);
        const reasoning = prewarmReasoningOption(pi.getThinkingLevel());
        const key = JSON.stringify({
            model: { provider: model.provider, id: model.id, api: model.api, baseUrl: model.baseUrl },
            systemPrompt: preparedSystemPrompt,
            messages,
            tools,
            reasoning,
            openai: config.openai,
            beta: config.beta,
            compaction: config.compaction,
            rewriteCompactedReplay,
        });
        return {
            model,
            config,
            preparedSystemPrompt,
            tools,
            reasoning,
            key,
        };
    };
    const startPrewarm = (ctx, systemPrompt = ctx.getSystemPrompt(), prepared = false, messages = [], rewriteCompactedReplay = false) => {
        const plan = buildPrewarmPlan(ctx, systemPrompt, prepared, messages, rewriteCompactedReplay);
        if (!plan)
            return undefined;
        const { model, config, preparedSystemPrompt, tools, reasoning, key: prewarmKey } = plan;
        if (prewarmedKey === prewarmKey)
            return undefined;
        if (pendingPrewarmKey === prewarmKey)
            return prewarmPromise;
        prewarmController?.abort();
        const controller = new AbortController();
        prewarmController = controller;
        pendingPrewarmKey = prewarmKey;
        const promise = (async () => {
            const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
            if (controller.signal.aborted)
                return { status: "aborted" };
            if (!auth.ok)
                return { status: "failed", error: new Error(auth.error) };
            if (!auth.apiKey)
                return {
                    status: "failed",
                    error: new Error(`No API key found for "${model.provider}"`),
                };
            const requestModel = auth.baseUrl ? { ...model, baseUrl: auth.baseUrl } : model;
            try {
                await prewarmOpenAICodexWebSocket(requestModel, { systemPrompt: preparedSystemPrompt, messages, tools }, {
                    apiKey: auth.apiKey,
                    ...(auth.headers ? { headers: auth.headers } : {}),
                    ...(auth.env ? { env: auth.env } : {}),
                    sessionId: ctx.sessionManager.getSessionId(),
                    signal: controller.signal,
                    ...reasoning,
                    textVerbosity: config.openai.verbosity,
                    ...(config.openai.fast ? { serviceTier: "priority" } : {}),
                    onPayload: (body) => rewriteCompactedReplay
                        ? rewriteCodexProviderRequest(body, ctx, { ...state, config })
                        : rewriteCodexPrewarmProviderRequest(body, ctx, { ...state, config }),
                }, {
                    getConfig: () => ({ openai: config.openai, beta: config.beta, compaction: config.compaction }),
                    useResponsesLite: (currentModel) => resolveCodexRuntimePlan({ model: currentModel }, config).kind === "code",
                    turnState: state.codexTurnState,
                    getDiagnostics: () => diagnostics.sink(),
                });
            }
            catch (error) {
                if (controller.signal.aborted)
                    return { status: "aborted" };
                const failure = error instanceof Error ? error : new Error(String(error));
                if (process.env["PI_DEBUG"] === "1") {
                    console.warn(`[pi-codex-conversion] WebSocket prewarm failed: ${failure.message}`);
                }
                return { status: "failed", error: failure };
            }
            if (controller.signal.aborted)
                return { status: "aborted" };
            prewarmedKey = prewarmKey;
            return { status: "ready" };
        })().finally(() => {
            if (prewarmPromise === promise) {
                prewarmPromise = undefined;
                if (pendingPrewarmKey === prewarmKey)
                    pendingPrewarmKey = undefined;
            }
            if (prewarmController === controller)
                prewarmController = undefined;
        });
        prewarmPromise = promise;
        return promise;
    };
    const runtime = {
        state,
        tracker,
        sessions,
        backgroundWidget: { folded: true },
        voice,
        lanVoice: new CodexLanVoiceServerController(voice, () => state.config, (text, ctx) => {
            if (ctx.isIdle())
                pi.sendUserMessage(text);
            else
                pi.sendUserMessage(text, { deliverAs: "steer" });
        }, dirname(getCodexConversionConfigPath())),
        execEnv(config = state.config) {
            return { ...process.env, PI_CODEX_MODEL: config.openai.webSearchModel };
        },
        codexSystemPrompt(basePrompt, ctx, skills = state.promptSkills, systemPromptOptions) {
            const plan = resolveCodexRuntimePlan(ctx, state.config);
            return buildCodexSystemPrompt(basePrompt, {
                skills,
                shell: getDefaultCodexRuntimeShell(),
                mode: plan.prompt ?? "normal",
                heavySystemPromptOverwrite: state.config.prompt.heavySystemPromptOverwrite,
                systemPromptOptions,
            });
        },
        startPrewarm(ctx, systemPrompt, prepared) {
            return startPrewarm(ctx, systemPrompt, prepared);
        },
        startCompactionPrewarm(ctx) {
            const messages = buildSessionContext(ctx.sessionManager.getBranch()).messages
                .filter((message) => !isProviderContextExcludedMessage(message));
            const activeSystemPrompt = state.activeProviderSystemPrompt;
            return startPrewarm(ctx, activeSystemPrompt ?? ctx.getSystemPrompt(), activeSystemPrompt !== undefined, convertToLlm(messages), true);
        },
        resetTransport(sessionId) {
            prewarmController?.abort();
            prewarmController = undefined;
            prewarmPromise = undefined;
            pendingPrewarmKey = undefined;
            prewarmedKey = undefined;
            state.codexTurnState.reset();
            if (sessionId)
                resetOpenAICodexWebSocketSessions(sessionId);
            else
                closeOpenAICodexWebSocketSessions();
        },
        resetTransportAfterCompaction(sessionId) {
            runtime.resetTransport(sessionId);
            closeOpenAICodexWebSocketSessions(sessionId);
        },
        shutdownTransport(sessionId) {
            runtime.resetTransport(sessionId);
            closeOpenAICodexWebSocketSessions(sessionId);
        },
        waitForPrewarm(ctx, systemPrompt) {
            return runtime.startPrewarm(ctx, systemPrompt, true);
        },
        prewarmIdentity(ctx, systemPrompt) {
            return buildPrewarmPlan(ctx, systemPrompt, true, [], false)?.key;
        },
        configureDiagnostics(ctx, announceLog = false) {
            return diagnostics.configure({
                mode: state.config.openai.cacheDiagnostics,
                active: ctx.model?.provider === "openai-codex",
                ctx,
                agentDir: dirname(getCodexConversionConfigPath()),
                announceLog,
            });
        },
        diagnosticsSink() {
            return diagnostics.sink();
        },
        shutdownDiagnostics() {
            return diagnostics.shutdown();
        },
    };
    return runtime;
}
