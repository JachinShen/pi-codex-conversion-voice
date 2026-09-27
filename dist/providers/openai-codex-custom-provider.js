import { createGrammarToolInputProperties } from "./constrained-sampling.js";
import { extractAccountId, buildWebSocketHeaders, PI_CODEX_CONVERSION_ORIGINATOR, resolveCodexWebSocketUrl } from "./openai-codex/headers.js";
import { noThrowCodexDiagnosticsSink } from "./openai-codex/diagnostic-failure.js";
import { buildRequestBody } from "./openai-codex/request-body.js";
import { supportsResponsesLiteModel } from "./openai-codex/responses-lite-model.js";
import { applyResponsesLiteRequest, applyResponsesLiteWebSocketMetadata, isResponsesLiteRequest, prepareResponsesLiteRequestImages } from "./openai-codex/responses-lite.js";
import { recordWebSocketSseFallback } from "./openai-codex/websocket.js";
import { isWebSocketMessageTooBigError, isWebSocketUpgradeRequiredError } from "./openai-codex/websocket-connection.js";
import { prewarmWebSocket } from "./openai-codex/websocket-stream.js";
import { openaiCodexNativeOAuthProvider } from "./openai-codex/oauth.js";
import { withCodexTurnState } from "./openai-codex/turn-state.js";
import { withRemoteCompactionV2Feature } from "./openai-responses/compaction-v2-feature.js";
import { normalizeResponsesToolHistory } from "./openai-responses/tool-history.js";
import { createCodexTransportStream, getEffectiveCodexTransport, } from "./openai-codex/transport-recovery.js";
export { buildRequestBody } from "./openai-codex/request-body.js";
export { parseSSE } from "./openai-codex/sse.js";
export { buildCachedWebSocketRequestBody } from "./openai-codex/websocket-continuation.js";
export { closeOpenAICodexWebSocketSessions } from "./openai-codex/websocket.js";
async function prepareCodexRequestBody(model, context, options, responsesLite) {
    let body = buildRequestBody(model, context, options);
    const nextBody = await options?.onPayload?.(body, model);
    if (nextBody !== undefined)
        body = nextBody;
    if (responsesLite) {
        body = isResponsesLiteRequest(body)
            ? { ...body, parallel_tool_calls: false }
            : applyResponsesLiteRequest(body);
        body = await prepareResponsesLiteRequestImages(body);
    }
    if (!body.previous_response_id) {
        const input = normalizeResponsesToolHistory(body.input ?? []);
        if (input !== body.input)
            body = { ...body, input };
    }
    return body;
}
export async function prewarmOpenAICodexWebSocket(model, context, options, deps) {
    const runtimeConfig = deps.getConfig?.();
    if (getEffectiveCodexTransport(options.transport, runtimeConfig?.openai, options.sessionId) === "sse")
        return;
    if (!options.apiKey || !options.sessionId)
        return;
    const responsesLite = deps.useResponsesLite?.(model) ?? (runtimeConfig?.beta.codeMode === true && supportsResponsesLiteModel(model.id));
    const grammarToolInputProperties = createGrammarToolInputProperties(context.tools, responsesLite);
    const effectiveOptions = runtimeConfig?.compaction?.responsesCompaction
        ? { ...options, grammarToolInputProperties, headers: withRemoteCompactionV2Feature(options.headers) }
        : { ...options, grammarToolInputProperties };
    const body = await prepareCodexRequestBody(model, context, effectiveOptions, responsesLite);
    const accountId = extractAccountId(options.apiKey);
    const originator = runtimeConfig?.openai.harnessIdentifierHeader ? PI_CODEX_CONVERSION_ORIGINATOR : undefined;
    const headers = buildWebSocketHeaders(model.headers, effectiveOptions.headers, accountId, options.apiKey, options.sessionId, originator);
    const websocketBody = withCodexTurnState(responsesLite ? applyResponsesLiteWebSocketMetadata(body) : body, deps.turnState);
    const diagnostics = noThrowCodexDiagnosticsSink(deps.getDiagnostics?.());
    try {
        await prewarmWebSocket(resolveCodexWebSocketUrl(model.baseUrl), websocketBody, headers, accountId, effectiveOptions, deps.turnState, diagnostics);
    }
    catch (error) {
        if (!options.signal?.aborted && (isWebSocketUpgradeRequiredError(error) || isWebSocketMessageTooBigError(error))) {
            recordWebSocketSseFallback(options.sessionId);
            return;
        }
        throw error;
    }
}
export function registerOpenAICodexCustomProvider(pi, options) {
    pi.registerProvider("openai-codex", {
        api: "openai-codex-responses",
        oauth: openaiCodexNativeOAuthProvider,
        streamSimple: (model, context, streamOptions) => createCodexTransportStream(model, context, streamOptions, {
            prepareRequestBody: prepareCodexRequestBody,
            ...(options.getConfig ? { getConfig: options.getConfig } : {}),
            ...(options.useResponsesLite ? { useResponsesLite: options.useResponsesLite } : {}),
            ...(options.turnState ? { turnState: options.turnState } : {}),
            ...(options.onPreparedPayload ? { onPreparedPayload: options.onPreparedPayload } : {}),
            ...(options.getDiagnostics ? { getDiagnostics: options.getDiagnostics } : {}),
        }),
    });
}
