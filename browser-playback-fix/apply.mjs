import { readFileSync, writeFileSync, cpSync, existsSync, realpathSync } from 'node:fs';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const here = dirname(fileURLToPath(import.meta.url));
export const manifest = JSON.parse(readFileSync(resolve(here, 'upstream.json')));
export function patch(text) {
  const queue = readFileSync(resolve(here, 'playback.js'), 'utf8');
  text = text.replace(/const PLAYBACK_START_SAMPLES = 960;\nconst PLAYBACK_MAX_SAMPLES = 6000;/, queue);
  text = text.replace('constructor() {\n    super();', 'constructor(options = {}) {\n    super();');
  text = text.replace(/    this.playback = new Float32Array\(PLAYBACK_MAX_SAMPLES\);[\s\S]*?    this.port.onmessage = \(event\) => this.queuePlayback\(event.data\);/, '    this.outputQueue = new BrowserPlaybackQueue(options.processorOptions);\n    this.port.onmessage = (event) => {\n      if (event.data?.type === "clear") this.outputQueue.clear();\n      else this.queuePlayback(event.data);\n    };');
  text = text.replace(/  queuePlayback\(value\) \{[\s\S]*?\n}\n\nregisterProcessor/, '  queuePlayback(value) { this.outputQueue.push(value); }\n\n  renderPlayback(output) { this.outputQueue.render(output); }\n}\n\nregisterProcessor');
  return text;
}
export function apply(source, destination) {
  source = realpathSync(source);
  destination = resolve(destination);
  if (existsSync(destination)) throw new Error('Output must not exist; in-place patching is forbidden');
  const parent = realpathSync(dirname(destination));
  destination = resolve(parent, destination.split(sep).at(-1));
  const nixBuildOutput = process.env.NIX_BUILD_TOP && destination === process.env.out;
  if (destination.startsWith(source + sep) || (destination.startsWith('/nix/store/') && !nixBuildOutput)) throw new Error('Unsafe output path');
  const pkg = JSON.parse(readFileSync(resolve(source, 'package.json')));
  if (pkg.name !== manifest.name || pkg.version !== manifest.version) throw new Error('Package identity/version mismatch');
  const changed = [];
  for (const [file, hash] of Object.entries(manifest.files)) {
    const data = readFileSync(resolve(source, file));
    if (createHash('sha256').update(data).digest('hex') !== hash) throw new Error('Original SHA256 mismatch: ' + file);
    changed.push([file, patch(data.toString())]);
  }
  cpSync(source, destination, { recursive: true, dereference: true });
  for (const [file, text] of changed) writeFileSync(resolve(destination, file), text);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4) throw new Error('Usage: node apply.mjs ORIGINAL_PACKAGE NEW_OUTPUT_DIRECTORY');
  apply(process.argv[2], process.argv[3]);
  console.log('Created patched copy (not activated): ' + resolve(process.argv[3]));
}
