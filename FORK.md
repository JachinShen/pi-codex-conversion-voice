# Browser playback fork (Git-only release candidate)

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

Root package.json still identifies the upstream package/version for compatibility; `private: true` and a failing prepublishOnly prevent accidental publication under upstream's npm name. Git commit is the fork version. Git installation loads `./dist/index.js` through the `pi.extensions` manifest. `prepare` builds using npm rather than requiring Bun. `prepack` builds; it does not imply the upstream full test suite passed. The monorepo-only extension verification script is removed. Build inputs and dependencies are pinned in package-lock.json; Pi's own Git installer runs npm install, so deployment should additionally use npm ci for strictly locked dependency installation.

## Validation

Unpack the original 3.0.10 npm archive into a separate directory, then run:

```sh
npm ci --ignore-scripts
npm run build
PI_VOICE_UPSTREAM=/absolute/path/to/pristine-package npm run test:browser-playback
npm pack
```

The tests only use synthetic PCM. Compare the resulting worklet template in source and dist and verify all native helpers against the original archive. Hardware/live Realtime checks are separate and opt-in. A user has reported normal listening with the browser fix; that does not identify which launch override or runtime served that session.

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
