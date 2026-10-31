// Decode once and play one pair of sounds per launch, regardless of rocket count.
export function createFireworkAudio() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return null;
  const context = new AudioContext();
  const sources = new Set();
  let disposed = false;
  let decoded = null;
  const buffers = Promise.all(['launch', 'explosion'].map(async name => {
    const response = await fetch(`/sounds/firework-${name}.wav`);
    if (!response.ok) throw new Error('Firework sound unavailable');
    return context.decodeAudioData(await response.arrayBuffer());
  })).then(result => { decoded = result; return result; }).catch(() => null);

  function play(buffer, when, volume, duration = buffer.duration) {
    const source = context.createBufferSource();
    const gain = context.createGain();
    const length = Math.min(duration, buffer.duration);
    source.buffer = buffer;
    gain.gain.setValueAtTime(volume, when);
    gain.gain.setValueAtTime(volume, when + Math.max(0, length - .06));
    gain.gain.linearRampToValueAtTime(0, when + length);
    source.connect(gain);
    gain.connect(context.destination);
    sources.add(source);
    source.onended = () => { sources.delete(source); source.disconnect(); gain.disconnect(); };
    source.start(when, 0, length);
  }

  return {
    prepare() {
      // Called directly from the click handler to unlock audio on mobile browsers.
      if (disposed) return null;
      if (context.state === 'running') return decoded || buffers;
      try {
        return context.resume().then(() => buffers).catch(() => null);
      } catch { return null; }
    },
    launch(decoded, flight, reducedMotion) {
      if (disposed || !decoded || context.state !== 'running') return;
      const start = context.currentTime;
      if (!reducedMotion) play(decoded[0], start, .224, flight);
      play(decoded[1], start + (reducedMotion ? 0 : flight), .24);
    },
    dispose() {
      disposed = true;
      for (const source of sources) source.stop();
      sources.clear();
      void context.close().catch(() => {});
    },
  };
}
