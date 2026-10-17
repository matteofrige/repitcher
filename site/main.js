// RePitch — comportamento del sito. Moduli ES, nessuna dipendenza.
// Senza JavaScript la pagina resta completa: qui si aggiungono solo suono e animazioni.
import { DONATION_URL, CONTACT_EMAIL } from './config.js';

document.documentElement.classList.replace('no-js', 'js');

// --- Configurazione letta da config.js --------------------------------------
document.querySelectorAll('[data-donate]').forEach((a) => { a.href = DONATION_URL; });
document.querySelectorAll('[data-contact]').forEach((a) => {
  a.href = `mailto:${CONTACT_EMAIL}`;
  if (a.hasAttribute('data-contact-text')) a.textContent = CONTACT_EMAIL;
});

// --- Ascolta il tuo La -----------------------------------------------------------
const root = document.querySelector('[data-la]');
if (root) {
  const slider = root.querySelector('[data-la-slider]');
  const out = root.querySelector('[data-la-value]');
  const note = root.querySelector('[data-la-note]');
  const playBtn = root.querySelector('[data-la-play]');
  const presets = [...root.querySelectorAll('input[name="la-preset"]')];
  const NOTE_STEP = 14 / 100; // px SVG per cent: lo spostamento è solo un cenno visivo
  let hz = Number(slider.value);

  const cents = (f) => 1200 * Math.log2(f / 440);
  const show = () => {
    out.textContent = hz;
    slider.setAttribute('aria-valuetext', `${hz} hertz`);
    note.setAttribute('transform', `translate(0 ${(-cents(hz) * NOTE_STEP * 0.35).toFixed(2)})`);
    presets.forEach((p) => { p.checked = Number(p.value) === hz; });
    if (voice) voice.setHz(hz);
  };

  // Voce sintetica: fondamentale più tre armoniche deboli, inviluppo morbido di circa 1,8 s.
  const PARTIALS = [[1, 1], [2, 0.3], [3, 0.12], [4, 0.05]];
  let ctx = null;
  let voice = null;
  // Etichette lette dalla pagina (data-label-play / data-label-stop), così le versioni linguistiche non toccano il codice.
  const labelPlay = playBtn.dataset.labelPlay || 'Ascolta';
  const labelStop = playBtn.dataset.labelStop || 'Ferma';
  const label = (on) => {
    playBtn.textContent = on ? labelStop : labelPlay;
    playBtn.setAttribute('aria-pressed', String(on));
  };
  function stopVoice(fast) {
    if (!voice) return;
    const v = voice;
    voice = null;
    const t = ctx.currentTime;
    v.master.gain.cancelScheduledValues(t);
    v.master.gain.setValueAtTime(Math.max(v.master.gain.value, 0.0001), t);
    v.master.gain.exponentialRampToValueAtTime(0.0001, t + (fast ? 0.06 : 0.2));
    v.oscs.forEach((o) => o.stop(t + 0.3));
    label(false);
  }
  function startVoice() {
    ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    ctx.resume();
    const t = ctx.currentTime;
    const master = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2600;
    master.gain.setValueAtTime(0.0001, t);
    master.gain.linearRampToValueAtTime(0.2, t + 0.05);
    master.gain.exponentialRampToValueAtTime(0.13, t + 0.45);
    master.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
    master.connect(lp).connect(ctx.destination);
    const oscs = PARTIALS.map(([m, a]) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = hz * m;
      g.gain.value = a / 1.5;
      o.connect(g).connect(master);
      o.start(t);
      o.stop(t + 1.9);
      return o;
    });
    const me = {
      master, oscs,
      setHz(f) { oscs.forEach((o, i) => o.frequency.setTargetAtTime(f * PARTIALS[i][0], ctx.currentTime, 0.03)); },
    };
    voice = me;
    oscs[0].onended = () => { if (voice === me) { voice = null; label(false); } };
    label(true);
  }

  slider.addEventListener('input', () => { hz = Number(slider.value); show(); });
  presets.forEach((p) => p.addEventListener('change', () => {
    hz = Number(p.value);
    slider.value = hz;
    show();
  }));
  playBtn.addEventListener('click', () => (voice ? stopVoice() : startVoice()));
  show();
}
