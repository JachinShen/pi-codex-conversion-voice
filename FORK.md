# Browser playback and compact LAN UI fork (Git-only)

This is the **complete** `@howaboua/pi-codex-conversion` package, not a standalone voice replacement. Use `voiceFeaturesOnly: true` in the extension settings when only voice is wanted. All runtime dependencies and all shipped native tools/voice helpers remain included. Requires Node >=22.19.0 and the peer Pi versions declared in package.json.

## Provenance and license

- Upstream repository: https://github.com/IgorWarzocha/howaboua-pi-stuff
- Upstream package: `packages/pi-codex-conversion`, version `3.0.10`
- Upstream source commit: `6cd01ee8dc0a68f686c86dfb14b43fd601e65074`
- Original npm archive: https://registry.npmjs.org/@howaboua/pi-codex-conversion/-/pi-codex-conversion-3.0.10.tgz
- Archive integrity: `sha512-7qsH8FcLGgF613sR6CorcQxY/2o8qyGQql+FwivDHhUexxUVARvRf2hBNex7uIPgMeoJ/k+X0t+wn1KElx/3ZA==`
- Retain upstream MIT copyright, `Copyright (c) 2026 Umberto B.`, in LICENSE, plus all bundled third-party LICENSE/NOTICE/UPSTREAM files. The fork does not claim upstream authorship.
- Browser playback modifications and regression tests are distributed under MIT (see LICENSE).

The release tree starts with the original npm archive (including prebuilt multi-platform helpers), applies the hash-guarded browser patch, then adds files absent from the archive from the exact upstream package commit (build configuration, tests, scripts and native source). `tsconfig.base.json` is copied from the same monorepo root and the local extends path is adjusted. Do not rebuild or replace native helpers independently of this base release.

## Intentional changes

`browser-playback-fix/` contains the original patch and 14 synthetic PCM regressions. Only the audio worklet source and matching compiled worklet change playback behavior. The bounded playback queue fixes large-chunk truncation and end-of-buffer loss, with explicit buffering/recovery limits. No credentials, audio recordings, server deployment settings or user-specific paths are included.

Root package.json still identifies the upstream package/version for compatibility; `private: true` and a failing prepublishOnly prevent accidental publication under upstream's npm name. Git commit is the fork version. Git installation loads `./dist/index.js` through the `pi.extensions` manifest. Production Git installation uses the committed, source-matched `dist` without a `prepare` hook: Pi 0.84.2 defaults to `npm install --omit=dev`, which does not install the development TypeScript compiler. Developers explicitly run `npm run build`; `prepack` still builds and requires development dependencies. Neither implies the upstream full test suite passed. The monorepo-only extension verification script is removed. Build inputs and dependencies are pinned in package-lock.json; the installation regression deliberately uses Pi's real default command rather than substituting `npm ci` or global settings.

## Compact LAN UI and live-only transcript

The production `web-ui` now uses the approved compact mobile layout: thin status bar, left/right text bubbles without per-message role labels, one-line composer, 44px touch targets, local pagination, scroll anchors and unread/back-to-bottom. Its production audio controller and composer are unchanged: microphone permission/device setup, mode selection (under the overflow menu), connect/end, mute, dictation and draft revision/conflict semantics remain real, not demo controls.

Only records received by the current page are accumulated in memory: at most 30 messages, 16 KiB UTF-8 text per message and 128 KiB serialized records total. Pi assistant text snapshots stream into one local message ID with monotonic revisions; voice user/assistant finalizations and successful LAN text submissions get independent local IDs. Voice callbacks are scoped to the actual current LAN conversation; delegation messages and transcript/context tails are not mirrored. Pi tools, thinking, auth, summaries and system context are never projected. These are live projection IDs, not persisted Pi entry IDs. Working/settled only affect status. Tree navigation resets the epoch; session replacement/reload tears down the server. Rendering uses `textContent`; slow SSE consumers are disconnected rather than accumulating unbounded queues.

**Not full session history:** no `getBranch()` export, session-file reader, history HTTP endpoint, localStorage or initial replay. Refreshing clears the page history; SSE reconnect retains already received rows in that same page but missed records are not recovered. Older-page loading only reveals up to 30 locally retained records. Terminal-origin user prompts are not imported. The existing LAN transport is still **not authenticated**; client IDs are not credentials. Keep it on a trusted LAN and do not expose it publicly. Pairing authorization must precede any future historical export.

Validation includes TypeScript/build, voice/LAN tests (including real HTTPS/SSE against an inert fake voice controller), the 14 original synthetic PCM regressions, and an isolated CDP page using the actual production HTML and a loopback fake backend. Browser checks cover 320px/390px widths, touch targets, pagination, a zero-pixel anchor shift at retention capacity, unread/back-to-bottom, stable streamed IDs, XSS, actual draft submission and audio control state transitions using stub devices/WebSocket. No paid speech service or physical microphone is used. The standalone fork has no root `knip` script (the upstream monorepo instruction cannot run here); typecheck/build pass. The full unrelated upstream suite is not claimed.

Run `node tests/voice-lan-browser-harness.mjs` after building for manual CDP checks; it logs a random loopback-only test URL. `/test/emit` exists only in that test harness, never in the production server. Neither fixture data nor demo subscriptions ship in the production HTML.

Before this UI change, compared the bundled Codex provider with the stock Pi peer: standard Responses fields, reasoning/service tier, headers/transport, terminal stream checks and retry behavior. Existing fork differences (Lite/turn metadata, full-request retries and sticky SSE) remain unchanged; this UI commit changes no provider request/auth/transport code or native/audio helpers.

## Validation

Unpack the original 3.0.10 npm archive into a separate directory, then run:

```sh
npm ci --ignore-scripts
npm run typecheck
npm run build
git diff --exit-code -- dist
PI_VOICE_UPSTREAM=/absolute/path/to/pristine-package npm run test:browser-playback
npm pack
# After committing: clean clone of HEAD, default production install, inert entry import.
npm run test:production-install
# Also test the published exact ref via ordinary HTTPS clone:
npm run test:production-install -- https://github.com/JachinShen/pi-codex-conversion-voice.git FULL_COMMIT_SHA
```

The production-install regression runs from a development checkout with `npm ci` completed. Its clean production clone receives only `npm install --omit=dev`; for the inert Node entry import, a resolution hook supplies declared Pi peer dependencies from the development checkout, modeling Pi's bundled-peer loader without adding development dependencies to the clone. It never invokes the extension entry function. The tests only use synthetic PCM. Compare the resulting worklet template in source and dist and verify all native helpers against the original archive. Hardware/live Realtime checks are separate and opt-in. A user has reported normal listening with the browser fix; that does not identify which launch override or runtime served that session.

## Installation after owner approval and push

```sh
pi install git:github.com/OWNER/pi-codex-conversion-voice@FULL_COMMIT_SHA
```

Replace OWNER and FULL_COMMIT_SHA only after explicit owner/repository confirmation. Do not enable this and the original npm source simultaneously. Never activate during an ongoing voice session. Roll back by restoring the original pinned npm source in a fresh session.

## Why standalone complete package

This preserves the npm release's tested runtime and native artifacts while making the repository root directly installable by Pi. A whole-monorepo fork preserves upstream history/Changesets better but installs all workspaces, and would need a root `pi.extensions: ["./packages/pi-codex-conversion/dist/index.js"]` manifest plus a build lifecycle hook; a plain monorepo Git URL is not equivalent to this package. Pi Git sources do not document a package-subdirectory selector.

The standalone cost is manual upstream synchronization of shared tsconfig/build infrastructure and future changes to scripts expecting `../..`. Some developer/native build scripts still assume monorepo infrastructure; standard TypeScript build and packaged prebuilt runtime do not. This candidate does not claim that every native regeneration or upstream release workflow is standalone-compatible.

## Latest upstream comparison

At preparation, npm latest is 3.0.39. Git main commit `61b493cf76cdd8e4789dd08d3a0ecee6c1c7c6eb` has the same audio worklet as npm 3.0.39. It adds mute/speaker suppression and changes startup to 1440 samples, but retains the 6000-sample cap and shift-ahead drain algorithm. It therefore does not incorporate these large-chunk/drain fixes. Do not apply this 3.0.10 hash-guarded patch blindly to newer versions.
