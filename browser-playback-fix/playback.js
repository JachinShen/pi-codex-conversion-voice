// Inserted into the upstream worklet; capture path is deliberately unchanged.
const boundedMs = (value, fallback, low, high) =>
  Number.isFinite(value) ? Math.max(low, Math.min(high, value)) : fallback;

class BrowserPlaybackQueue {
  constructor(options = {}) {
    this.capacity = Math.ceil(boundedMs(options.maxBufferMs, 2000, 300, 5000) * 24);
    this.start = Math.min(this.capacity, Math.ceil(boundedMs(options.startBufferMs, 80, 0, 500) * 24));
    this.recover = Math.min(this.capacity, Math.ceil(boundedMs(options.recoveryBufferMs, 120, 0, 500) * 24));
    this.waitFrames = Math.ceil(boundedMs(options.maxWaitMs, 120, 20, 500) * sampleRate / 1000);
    this.data = new Float32Array(this.capacity);
    this.stats = { received: 0, dropped: 0, underruns: 0, highWater: 0, chunks: 0, maxArrivalGapFrames: 0 };
    this.clock = 0;
    this.lastArrival = null;
    this.clear();
  }
  clear() {
    this.read = 0;
    this.length = 0;
    this.phase = 0;
    this.playing = false;
    this.recovering = false;
    this.waited = 0;
  }
  push(value) {
    if (!(value instanceof ArrayBuffer) || !value.byteLength || value.byteLength % 2) return;
    const samples = new Int16Array(value);
    this.stats.received += samples.length;
    this.stats.chunks++;
    if (this.lastArrival !== null) this.stats.maxArrivalGapFrames = Math.max(this.stats.maxArrivalGapFrames, this.clock - this.lastArrival);
    this.lastArrival = this.clock;
    // Only discard at the explicit latency ceiling, never at a single-chunk 250ms limit.
    const excess = Math.max(0, this.length + samples.length - this.capacity);
    if (excess) {
      const old = Math.min(excess, this.length);
      this.read = (this.read + old) % this.capacity;
      this.length -= old;
      this.stats.dropped += excess;
      this.phase = 0;
    }
    const skip = Math.max(0, samples.length - this.capacity);
    for (let i = skip; i < samples.length; i++) {
      const sample = samples[i];
      this.data[(this.read + this.length++) % this.capacity] = sample / (sample < 0 ? 32768 : 32767);
    }
    this.stats.highWater = Math.max(this.stats.highWater, this.length);
  }
  render(output) {
    output.fill(0);
    this.clock += output.length;
    if (!this.playing) {
      if (!this.length) return;
      this.waited += output.length;
      const threshold = this.recovering ? this.recover : this.start;
      if (this.length < threshold && this.waited < this.waitFrames) return;
      this.playing = true;
      this.waited = 0;
    }
    const step = TARGET_RATE / sampleRate;
    for (let i = 0; i < output.length; i++) {
      // Keep current and lookahead IN the ring: draining cannot strand either sample.
      const consume = Math.min(Math.floor(this.phase + 1e-10), this.length);
      this.read = (this.read + consume) % this.capacity;
      this.length -= consume;
      this.phase -= consume;
      if (!this.length) {
        this.playing = false;
        this.recovering = true;
        this.phase = 0;
        this.stats.underruns++;
        return;
      }
      const a = this.data[this.read];
      // No EOS exists in the wire protocol. Hold the final sample for its full duration.
      const b = this.length > 1 ? this.data[(this.read + 1) % this.capacity] : a;
      output[i] = a + (b - a) * Math.max(0, this.phase);
      this.phase += step;
    }
  }
}
