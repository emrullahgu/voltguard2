'use strict';
// Hızlı pencere geçişleri: gerçek audio modülü, elle tamamlanan WebAudio suspend.
const { makeEnv, suite, eq } = require('./controller_harness');
class Param {
  constructor(value = 0) { this.value = value; }
  setValueAtTime(v) { this.value = v; } exponentialRampToValueAtTime(v) { this.value = v; }
  linearRampToValueAtTime(v) { this.value = v; } setTargetAtTime(v) { this.value = v; } cancelScheduledValues() {}
}
class Node {
  constructor() { for (const p of ['gain', 'frequency', 'Q', 'threshold', 'ratio', 'knee', 'attack', 'release']) this[p] = new Param(); }
  connect() {} disconnect() {} start() {} stop() {}
}
function env() {
  const E = makeEnv();
  class AudioContext {
    constructor() { this.state = 'running'; this.sampleRate = 22050; this.currentTime = 0; this.destination = new Node(); this.pendingSuspend = null; }
    createGain() { return new Node(); } createDynamicsCompressor() { return new Node(); }
    createOscillator() { return new Node(); } createBiquadFilter() { return new Node(); } createBufferSource() { return new Node(); }
    createBuffer(ch, n, sr) { const data = new Float32Array(n); return { duration: n / sr, getChannelData() { return data; } }; }
    resume() { this.state = 'running'; if (this.onstatechange) this.onstatechange(); return Promise.resolve(); }
    suspend() {
      return new Promise(resolve => { this.pendingSuspend = () => { this.state = 'suspended'; if (this.onstatechange) this.onstatechange(); this.pendingSuspend = null; resolve(); }; });
    }
  }
  E.ctx.window.AudioContext = AudioContext; E.ctx.document = { addEventListener() {}, hidden: false };
  E.load('audio/audio.js'); E.PX.audio.init();
  E.fire = type => { for (const fn of E.winL[type] || []) fn(); };
  return E;
}
module.exports = async function run() {
  const { test, res } = suite('audio_lifecycle'); console.log('audio_lifecycle');
  await test('askıya alma sürerken odak geri gelirse ses bağlamı çalışmaya döner', async () => {
    const E = env(); E.fire('blur'); E.advance(50);
    const c = E.PX.audio.ctx; E.fire('focus'); eq(E.PX.audio.stats().held, false);
    c.pendingSuspend(); await E.tick(); eq(c.state, 'running', 'geciken suspend odaklı pencereyi sessiz bırakamaz');
  });
  await test('odak geri gelmeden askıya alma biterse ses askıda kalır', async () => {
    const E = env(); E.fire('blur'); E.advance(50); const c = E.PX.audio.ctx;
    c.pendingSuspend(); await E.tick(); eq(c.state, 'suspended'); eq(E.PX.audio.stats().held, true);
    E.fire('focus'); await E.tick(); eq(c.state, 'running');
  });
  return res;
};
if (require.main === module) module.exports().then(r => { console.log(`${r.name}: ${r.pass} ok, ${r.fail} fail`); process.exit(r.fail ? 1 : 0); });
