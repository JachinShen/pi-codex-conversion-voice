# src must be an unpacked, pristine @howaboua/pi-codex-conversion 3.0.10.
# This produces a package COPY, not a Home Manager activation or Pi installation.
{ runCommand, nodejs, src }:
runCommand "pi-codex-conversion-3.0.10-browser-playback-fix" {
  nativeBuildInputs = [ nodejs ];
} ''
  export PI_VOICE_UPSTREAM=${src}
  node --test ${./.}/test.mjs
  node ${./.}/apply.mjs ${src} "$out"
''
