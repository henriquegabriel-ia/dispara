'use client';

/**
 * Hook de efeitos sonoros - Web Audio API
 * Sons sintéticos estilo Blade Runner, keep it simple.
 */

const isDev = process.env.NODE_ENV === 'development';

let audioCtx: AudioContext | null = null;
let ambientAudio: HTMLAudioElement | null = null;
let ambientPlaying = false;

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  // Resume se estiver suspenso (política de autoplay)
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

/**
 * Som de sucesso - tom ascendente suave
 */
export function playSuccess() {
  try {
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(400, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.15);

    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch (e) {
    console.warn('[SoundFX] playSuccess error:', e);
  }
}

/**
 * Som de erro - buzz dissonante curto
 */
export function playError() {
  const ctx = getAudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(150, ctx.currentTime);
  osc.frequency.setValueAtTime(120, ctx.currentTime + 0.1);

  gain.gain.setValueAtTime(0.1, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start();
  osc.stop(ctx.currentTime + 0.2);
}

/**
 * Som de transição - whoosh suave
 */
export function playTransition() {
  try {
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    // Onda sine suave, frequência estável
    osc.type = 'sine';
    osc.frequency.setValueAtTime(380, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(280, ctx.currentTime + 0.2);

    // Filtro passa-baixa para suavizar
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(600, ctx.currentTime);

    // Volume bem baixo com fade suave
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.08, ctx.currentTime + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.25);
  } catch (e) {
    console.warn('[SoundFX] playTransition error:', e);
  }
}

/**
 * Som de conclusão - acorde ascendente (despertar)
 */
export function playComplete() {
  const ctx = getAudioContext();
  const frequencies = [400, 500, 600, 800]; // Acorde maior ascendente

  frequencies.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.1);

    gain.gain.setValueAtTime(0, ctx.currentTime + i * 0.1);
    gain.gain.linearRampToValueAtTime(0.12, ctx.currentTime + i * 0.1 + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + i * 0.1 + 0.5);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(ctx.currentTime + i * 0.1);
    osc.stop(ctx.currentTime + i * 0.1 + 0.5);
  });
}

/**
 * Som de typing/input - click suave
 */
export function playClick() {
  const ctx = getAudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'square';
  osc.frequency.setValueAtTime(1200, ctx.currentTime);

  gain.gain.setValueAtTime(0.03, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.02);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start();
  osc.stop(ctx.currentTime + 0.02);
}

/**
 * Ambient music - HTMLAudioElement puro (mais compatível)
 * Fade in/out via volume property
 */
export function startAmbient(): void {
  if (ambientPlaying) {
    return;
  }

  // Cria elemento de áudio se não existe
  if (!ambientAudio) {
    ambientAudio = new Audio('/nexus.mp3');
    ambientAudio.loop = true;
    ambientAudio.volume = 0;
    ambientAudio.preload = 'auto';
  }

  // play() retorna Promise, mas chamamos de forma síncrona
  const playPromise = ambientAudio.play();

  if (playPromise !== undefined) {
    playPromise
      .then(() => {
        ambientPlaying = true;
        // Fade in simples com setInterval
        fadeVolume(ambientAudio!, 0.15, 3000);
      })
      .catch((error) => {
        console.error('[SoundFX] Play failed:', error.name, error.message);
        ambientPlaying = false;
      });
  }
}

/**
 * Fade volume de um elemento de áudio
 */
function fadeVolume(audio: HTMLAudioElement, targetVolume: number, duration: number): void {
  const startVolume = audio.volume;
  const volumeDiff = targetVolume - startVolume;
  const steps = 30;
  const stepTime = duration / steps;
  let currentStep = 0;

  const fadeInterval = setInterval(() => {
    currentStep++;
    const progress = currentStep / steps;
    audio.volume = startVolume + (volumeDiff * progress);

    if (currentStep >= steps) {
      clearInterval(fadeInterval);
      audio.volume = targetVolume;
    }
  }, stepTime);
}

/**
 * Para o ambient com fade out suave
 */
export function stopAmbient(): void {
  if (!ambientPlaying || !ambientAudio) return;

  // Fade out
  fadeVolume(ambientAudio, 0, 2000);

  // Para após fade out
  setTimeout(() => {
    if (ambientAudio) {
      ambientAudio.pause();
      ambientAudio.currentTime = 0;
    }
    ambientPlaying = false;
  }, 2100);
}

/**
 * Hook que retorna todas as funções de som
 */
export function useSoundFX() {
  return {
    playSuccess,
    playError,
    playTransition,
    playComplete,
    playClick,
    startAmbient,
    stopAmbient,
  };
}
