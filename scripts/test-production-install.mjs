// Exercise Pi 0.84.2's default Git installation, never the live Pi directory.
// Tests committed HEAD by default; optional arguments: repository, exact ref.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repository = process.argv[2] || root;
const ref = process.argv[3] || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const temp = mkdtempSync(join(tmpdir(), 'pi-voice-production-'));
const cwd = join(temp, 'package');
const run = (command, args) => execFileSync(command, args, { cwd, stdio: 'inherit' });
try {
  execFileSync('git', ['clone', '--', repository, cwd], { stdio: 'inherit' });
  run('git', ['checkout', ref]);
  assert.ok(!existsSync(join(cwd, 'node_modules')), 'clone must have no installed dependencies');
  const entry = join(cwd, 'dist/index.js');
  const before = readFileSync(entry);
  // Do not replace with npm ci, ignore-scripts, or a custom npmCommand.
  run('npm', ['install', '--omit=dev']);
  assert.deepEqual(readFileSync(entry), before, 'production install must retain prebuilt entry');
  run('git', ['diff', '--exit-code', '--', 'dist', 'src']);
  // Import only: never call the extension registration function, start voice,
  // request microphone access, or call a model. Resolves the static import graph.
  run(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { createRequire, registerHooks } from 'node:module';
    import { readFileSync } from 'node:fs';
    const require = createRequire(new URL('./package.json', import.meta.url));
    const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
    for (const name of Object.keys(manifest.dependencies)) require.resolve(name);
    // Pi supplies its bundled peers through its extension loader. A bare Node
    // import has no such host: use this development checkout as the peer fixture
    // only, without installing dev dependencies in the production clone.
    const hostURL = ${JSON.stringify(pathToFileURL(join(root, 'package.json')).href)};
    registerHooks({ resolve(specifier, context, nextResolve) {
      if (Object.keys(manifest.peerDependencies).some(name => specifier === name || specifier.startsWith(name + '/'))) {
        return nextResolve(specifier, { ...context, parentURL: hostURL });
      }
      return nextResolve(specifier, context);
    }});
    const entry = await import('./dist/index.js');
    assert.equal(typeof entry.default, 'function');
    console.log('Production dependencies and dist entry resolve (Pi peers supplied by dev host fixture); extension not activated.');
  `]);
  console.log(`Production installation passed: ${ref}`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
