import { createHash } from "node:crypto";
import { closeWebSocketSilently, connectWebSocket, isWebSocketReusable, resolveWebSocketProxyForTarget } from "./websocket-connection.js";
const websocketSessionCache = new Map();
const websocketSseFallbackSessions = new Set();
const SESSION_WEBSOCKET_MAX_AGE_MS = 55 * 60 * 1000;
const CONTINUATION_HEADERS = new Set([
    "openai-beta",
    "session-id",
    "thread-id",
    "x-client-request-id",
    "x-codex-beta-features",
]);
function routeIdentityHeaders(headers) {
    return [...headers.entries()]
        .filter(([name]) => !CONTINUATION_HEADERS.has(name.toLowerCase()))
        .sort(([left], [right]) => left.localeCompare(right));
}
async function websocketRouteKey(url, headers, accountId, env) {
    const proxy = await resolveWebSocketProxyForTarget(url, env);
    const handshakeIdentity = JSON.stringify([
        accountId,
        new URL(url).href,
        proxy ?? null,
        routeIdentityHeaders(headers),
    ]);
    return createHash("sha256").update(handshakeIdentity).digest("base64url");
}
export function isWebSocketSseFallbackActive(sessionId) {
    return sessionId ? websocketSseFallbackSessions.has(sessionId) : false;
}
export function recordWebSocketSseFallback(sessionId) {
    if (sessionId)
        websocketSseFallbackSessions.add(sessionId);
}
function isWebSocketSessionExpired(entry) {
    return Date.now() - entry.createdAt >= SESSION_WEBSOCKET_MAX_AGE_MS;
}
function scheduleSessionWebSocketExpiry(sessionId, routeKey, entry) {
    if (entry.idleTimer) {
        clearTimeout(entry.idleTimer);
    }
    const remainingLifetimeMs = Math.max(0, SESSION_WEBSOCKET_MAX_AGE_MS - (Date.now() - entry.createdAt));
    entry.idleTimer = setTimeout(() => {
        if (entry.busy)
            return;
        closeWebSocketSilently(entry.socket, 1000, "connection_age_limit");
        const routeEntries = websocketSessionCache.get(sessionId);
        if (routeEntries?.get(routeKey) === entry)
            routeEntries.delete(routeKey);
        if (routeEntries?.size === 0)
            websocketSessionCache.delete(sessionId);
    }, remainingLifetimeMs);
}
function closeWebSocketSessions(sessionId) {
    const closeEntry = (entry) => {
        if (entry.idleTimer) {
            clearTimeout(entry.idleTimer);
            entry.idleTimer = undefined;
        }
        closeWebSocketSilently(entry.socket, 1000, "session_shutdown");
    };
    if (sessionId) {
        for (const entry of websocketSessionCache.get(sessionId)?.values() ?? [])
            closeEntry(entry);
        websocketSessionCache.delete(sessionId);
        return;
    }
    for (const routeEntries of websocketSessionCache.values()) {
        for (const entry of routeEntries.values())
            closeEntry(entry);
    }
    websocketSessionCache.clear();
}
export function resetOpenAICodexWebSocketSessions(sessionId) {
    closeWebSocketSessions(sessionId);
}
export function closeOpenAICodexWebSocketSessions(sessionId) {
    closeWebSocketSessions(sessionId);
    if (sessionId) {
        websocketSseFallbackSessions.delete(sessionId);
        return;
    }
    websocketSseFallbackSessions.clear();
}
export async function acquireWebSocket(url, headers, sessionId, accountId, signal, connectTimeoutMs, env) {
    if (!sessionId) {
        const socket = await connectWebSocket(url, headers, signal, connectTimeoutMs, env);
        return {
            socket,
            reused: false,
            release: ({ keep } = {}) => {
                if (keep === false) {
                    closeWebSocketSilently(socket);
                    return;
                }
                closeWebSocketSilently(socket);
            },
        };
    }
    const routeKey = await websocketRouteKey(url, headers, accountId, env);
    let routeEntries = websocketSessionCache.get(sessionId);
    const cached = routeEntries?.get(routeKey);
    if (cached) {
        if (cached.idleTimer) {
            clearTimeout(cached.idleTimer);
            cached.idleTimer = undefined;
        }
        if (!cached.busy && isWebSocketSessionExpired(cached)) {
            closeWebSocketSilently(cached.socket, 1000, "connection_age_limit");
            routeEntries?.delete(routeKey);
            if (routeEntries?.size === 0)
                websocketSessionCache.delete(sessionId);
        }
        else if (!cached.busy && isWebSocketReusable(cached.socket)) {
            cached.busy = true;
            return {
                socket: cached.socket,
                entry: cached,
                reused: true,
                release: ({ keep } = {}) => {
                    if (!keep || !isWebSocketReusable(cached.socket)) {
                        closeWebSocketSilently(cached.socket);
                        const currentEntries = websocketSessionCache.get(sessionId);
                        if (currentEntries?.get(routeKey) === cached)
                            currentEntries.delete(routeKey);
                        if (currentEntries?.size === 0)
                            websocketSessionCache.delete(sessionId);
                        return;
                    }
                    cached.busy = false;
                    scheduleSessionWebSocketExpiry(sessionId, routeKey, cached);
                },
            };
        }
        if (cached.busy) {
            const socket = await connectWebSocket(url, headers, signal, connectTimeoutMs, env);
            return {
                socket,
                reused: false,
                release: () => {
                    closeWebSocketSilently(socket);
                },
            };
        }
        if (!isWebSocketReusable(cached.socket)) {
            closeWebSocketSilently(cached.socket);
            routeEntries?.delete(routeKey);
            if (routeEntries?.size === 0)
                websocketSessionCache.delete(sessionId);
        }
    }
    const socket = await connectWebSocket(url, headers, signal, connectTimeoutMs, env);
    const entry = { socket, busy: true, createdAt: Date.now() };
    routeEntries = websocketSessionCache.get(sessionId);
    if (!routeEntries) {
        routeEntries = new Map();
        websocketSessionCache.set(sessionId, routeEntries);
    }
    routeEntries.set(routeKey, entry);
    return {
        socket,
        entry,
        reused: false,
        release: ({ keep } = {}) => {
            if (!keep || !isWebSocketReusable(entry.socket)) {
                closeWebSocketSilently(entry.socket);
                if (entry.idleTimer)
                    clearTimeout(entry.idleTimer);
                const currentEntries = websocketSessionCache.get(sessionId);
                if (currentEntries?.get(routeKey) === entry)
                    currentEntries.delete(routeKey);
                if (currentEntries?.size === 0)
                    websocketSessionCache.delete(sessionId);
                return;
            }
            entry.busy = false;
            scheduleSessionWebSocketExpiry(sessionId, routeKey, entry);
        },
    };
}
