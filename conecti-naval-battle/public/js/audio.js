/*
 * Sonidos retro originales con Web Audio API (sin archivos).
 * El audio arranca solo después del primer toque del jugador (regla de los navegadores).
 */
(function (root) {
  let ac = null, master = null;
  const KEY = 'cnb-audio';
  const cfg = (() => { try { return { mute: false, volume: 0.7, ...JSON.parse(localStorage.getItem(KEY)) }; } catch (e) { return { mute: false, volume: 0.7 }; } })();
  const guardar = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) {} };

  function unlock() {
    try {
      if (!ac) {
        ac = new (window.AudioContext || window.webkitAudioContext)();
        master = ac.createGain();
        master.connect(ac.destination);
        aplicar();
      }
      if (ac.state === 'suspended') ac.resume();
    } catch (e) { ac = null; }
  }
  function aplicar() { if (master) master.gain.value = cfg.mute ? 0 : cfg.volume * 0.6; }

  function tono(f0, f1, dur, tipo = 'square', vol = 0.12, ret = 0) {
    if (!ac || cfg.mute) return;
    const t = ac.currentTime + ret, o = ac.createOscillator(), g = ac.createGain();
    o.type = tipo; o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.03);
  }
  let ruidoBuf = null;
  function ruido(dur, frec, vol = 0.3, ret = 0, tipo = 'lowpass') {
    if (!ac || cfg.mute) return;
    if (!ruidoBuf) {
      ruidoBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
      const d = ruidoBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const t = ac.currentTime + ret, s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = ruidoBuf; f.type = tipo; f.frequency.value = frec;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(master); s.start(t, Math.random()); s.stop(t + dur + 0.03);
  }

  const notas = (lista, tipo = 'square', vol = 0.09, paso = 0.12, dur = 0.16) => lista.forEach((f, i) => f && tono(f, 0, dur, tipo, vol, i * paso));

  const SFX = {
    click:   () => tono(880, 0, 0.05, 'square', 0.06),
    start:   () => { notas([392, 523, 659, 784, 0, 784, 1047], 'square', 0.08, 0.1); ruido(0.3, 3000, 0.05, 0.7, 'highpass'); },
    turn:    () => notas([659, 988], 'square', 0.08, 0.1, 0.12),
    move:    () => { tono(70, 55, 0.09, 'sawtooth', 0.07); ruido(0.08, 500, 0.05); },
    fire:    () => { ruido(0.45, 900, 0.5); tono(160, 40, 0.35, 'square', 0.2); },
    whistle: ms => tono(1400, 500, Math.min(4, Math.max(0.3, ms / 1000)), 'triangle', 0.035),
    impact:  () => { ruido(0.8, 500, 0.6); tono(110, 30, 0.6, 'square', 0.22); ruido(0.4, 2500, 0.2, 0.05, 'highpass'); },
    armor:   () => { tono(1200, 700, 0.12, 'square', 0.1); tono(600, 300, 0.2, 'triangle', 0.12, 0.05); ruido(0.3, 1200, 0.25); },
    splash:  () => { ruido(0.6, 1600, 0.35); tono(500, 150, 0.25, 'sine', 0.08); },
    tick:    () => tono(1320, 0, 0.04, 'square', 0.05),
    win:     () => notas([523, 659, 784, 1047, 784, 1047, 1319], 'square', 0.08, 0.13, 0.2),
    lose:    () => notas([392, 370, 349, 330, 262], 'triangle', 0.14, 0.22, 0.3),
    alert:   () => notas([880, 0, 880], 'square', 0.07, 0.12, 0.08),
  };

  root.AUDIO = {
    unlock,
    play(nombre, ...args) { if (SFX[nombre]) { unlock(); SFX[nombre](...args); } },
    get muted() { return cfg.mute; },
    get volume() { return cfg.volume; },
    setMuted(v) { cfg.mute = !!v; aplicar(); guardar(); },
    setVolume(v) { cfg.volume = Math.max(0, Math.min(1, v)); aplicar(); guardar(); },
    suspend() { if (ac && ac.state === 'running') ac.suspend(); },
    resume() { if (ac && ac.state === 'suspended') ac.resume(); },
  };
})(window);
