import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { mkdtempSync, readFileSync, cpSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply, manifest } from './apply.mjs';
const source = process.env.PI_VOICE_UPSTREAM;
assert.ok(source, 'Set PI_VOICE_UPSTREAM to the unmodified 3.0.10 package');
const temp = mkdtempSync(join(tmpdir(), 'pi-voice-test-'));
const original = join(temp, 'original');
const fixed = join(temp, 'fixed');
cpSync(source, original, { recursive: true, dereference: true });
apply(original, fixed);
process.on('exit', () => rmSync(temp, { recursive: true, force: true }));
function load(root, rate = 48000, options = {}, file = 'src/voice/lan/audio-worklet.ts') {
  const text = readFileSync(join(root, file), 'utf8');
  let Processor;
  vm.runInNewContext(text.slice(text.indexOf('`') + 1, text.lastIndexOf('`')), {
    sampleRate: rate, ArrayBuffer, Int16Array, Float32Array,
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage() {} }; } },
    registerProcessor(_, value) { Processor = value; },
  });
  return new Processor({ processorOptions: options });
}
const pcm = (n, offset = 0) => Int16Array.from({ length: n }, (_, i) => 1000 + ((i + offset) % 23000));
const render = (p, n) => { const out = new Float32Array(n); p.renderPlayback(out); return out; };
const normalized = x => x / (x < 0 ? 32768 : 32767);
function compare(actual, expected) {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < actual.length; i++) assert.ok(Math.abs(actual[i] - expected[i]) < 2e-7, `sample ${i}: ${actual[i]} != ${expected[i]}`);
}
for (const file of Object.keys(manifest.files)) {
  test(`${file}: 300ms chunk preserves every sample; original truncates`, () => {
    const input = pcm(7200);
    const old = load(original, 24000, {}, file);
    old.queuePlayback(input.buffer);
    assert.notEqual(render(old, 1)[0], Math.fround(normalized(input[0])));
    const p = load(fixed, 24000, {}, file);
    p.queuePlayback(input.buffer);
    compare(render(p, 7200), Array.from(input, normalized));
    assert.equal(p.outputQueue.stats.dropped, 0);
  });
}
for (const rate of [16000, 24000, 44100, 48000, 96000]) {
  test(`continuous interpolation and complete drain at ${rate}Hz`, () => {
    const p = load(fixed, rate);
    const input = pcm(7200);
    p.queuePlayback(input.buffer);
    const n = Math.ceil(input.length * rate / 24000);
    const out = [];
    while (out.length < n) out.push(...render(p, Math.min(128, n - out.length)));
    const expected = Array.from({ length: n }, (_, i) => {
      const pos = i * 24000 / rate, base = Math.floor(pos), frac = pos - base;
      const a = normalized(input[base]), b = normalized(input[Math.min(base + 1, input.length - 1)]);
      return a + (b - a) * frac;
    });
    compare(out, expected);
    assert.ok(render(p, 128).every(x => x === 0));
  });
}
test('80ms startup reserve bridges a synthetic 20ms late arrival', () => {
  const old = load(original);
  const fixedQueue = load(fixed);
  // 40ms chunks at t=0, 60, 100ms. Original starts immediately and starves;
  // the patched queue starts at 60ms with 80ms reserve and stays continuous.
  const arrivals = new Set([0, 60, 100]);
  const oldOut = [], newOut = [];
  for (let ms = 0; ms < 140; ms++) {
    if (arrivals.has(ms)) {
      old.queuePlayback(pcm(960).buffer);
      fixedQueue.queuePlayback(pcm(960).buffer);
    }
    oldOut.push(...render(old, 48));
    newOut.push(...render(fixedQueue, 48));
  }
  assert.ok(oldOut.slice(40 * 48, 60 * 48).some(x => x === 0));
  assert.ok(newOut.slice(60 * 48).every(x => x !== 0));
  assert.equal(fixedQueue.outputQueue.stats.underruns, 0);
});
test('original 48kHz loses two boundary output samples', () => {
  const p = load(original);
  p.queuePlayback(pcm(2400).buffer);
  assert.equal(Array.from(render(p, 4800)).filter(x => x !== 0).length, 4798);
  const q = load(fixed);
  q.queuePlayback(pcm(2400).buffer);
  assert.equal(Array.from(render(q, 4800)).filter(x => x !== 0).length, 4800);
});
test('burst partitioning matches single chunk across render boundaries', () => {
  const p = load(fixed, 48000, { startBufferMs: 0 });
  const input = pcm(12000);
  p.queuePlayback(input.slice(0, 2400).buffer);
  const actual = [...render(p, 2048)];
  for (const [a, b] of [[2400, 2401], [2401, 7000], [7000, 12000]]) p.queuePlayback(input.slice(a, b).buffer);
  actual.push(...render(p, 24000 - 2048));
  const q = load(fixed, 48000, { startBufferMs: 0 });
  q.queuePlayback(input.buffer);
  compare(actual, render(q, 24000));
});
test('underrun recovery buffers, short final chunk has bounded wait', () => {
  const p = load(fixed);
  p.queuePlayback(pcm(2400).buffer);
  render(p, 5000);
  assert.equal(p.outputQueue.stats.underruns, 1);
  p.queuePlayback(pcm(100).buffer);
  assert.ok(render(p, 128).every(x => x === 0));
  let nonzero = 0;
  for (let i = 0; i < 60; i++) nonzero += Array.from(render(p, 128)).filter(x => x !== 0).length;
  assert.equal(nonzero, 200);
});
test('60 seconds sustained overload remains bounded, clear is immediate', () => {
  const p = load(fixed, 48000, { maxBufferMs: 300 });
  for (let i = 0; i < 6000; i++) {
    p.queuePlayback(pcm(480).buffer);
    render(p, 480);
    assert.ok(p.outputQueue.length <= 7200);
  }
  assert.ok(p.outputQueue.stats.dropped > 0);
  p.port.onmessage({ data: { type: 'clear' } });
  assert.ok(render(p, 128).every(x => x === 0));
  assert.equal(p.outputQueue.length, 0);
});
test('invalid messages ignored; oversized input explicitly capped', () => {
  const p = load(fixed, 48000, { maxBufferMs: 300 });
  for (const value of [null, {}, new ArrayBuffer(1), new ArrayBuffer(0)]) p.queuePlayback(value);
  assert.equal(p.outputQueue.length, 0);
  p.queuePlayback(pcm(24000).buffer);
  assert.equal(p.outputQueue.length, 7200);
  assert.equal(p.outputQueue.stats.dropped, 16800);
});
test('applier rejects reapplication, existing output, wrong version and changed source', () => {
  assert.throws(() => apply(original, fixed), /must not exist/);
  assert.throws(() => apply(fixed, join(temp, 'twice')), /SHA256/);
  const pkgPath = join(original, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath));
  writeFileSync(pkgPath, JSON.stringify({ ...pkg, version: '3.0.11' }));
  assert.throws(() => apply(original, join(temp, 'wrong')), /version/);
  writeFileSync(pkgPath, JSON.stringify(pkg));
  writeFileSync(join(original, 'src/voice/lan/audio-worklet.ts'), 'changed');
  assert.throws(() => apply(original, join(temp, 'changed')), /SHA256/);
});
