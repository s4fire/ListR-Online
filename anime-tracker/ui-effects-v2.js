export const UI_SOUND_STORAGE_KEY_V2 = 'listr-ui-sounds-v2';

export function canPlayUiSoundV2({ enabled, pageHidden = false, mediaPlaying = false } = {}) {
  return enabled === true && pageHidden !== true && mediaPlaying !== true;
}

const CUES = {
  click: [[470, 0, 0.038]],
  navigate: [[460, 0, 0.045], [650, 0.045, 0.06]],
  dialog: [[540, 0, 0.052], [720, 0.035, 0.06]],
  success: [[520, 0, 0.055], [660, 0.045, 0.065], [830, 0.09, 0.085]],
  error: [[350, 0, 0.075], [260, 0.065, 0.09]],
  info: [[520, 0, 0.045]],
};

export function initializeUIEffectsV2({ documentRef = globalThis.document, windowRef = globalThis.window } = {}) {
  if (!documentRef || !windowRef) return () => {};
  const toggle = documentRef.getElementById('sound-toggle');
  if (!toggle) return () => {};

  let storage = null;
  try { storage = windowRef.localStorage; } catch { /* Storage can be blocked by browser settings. */ }
  let enabled = true;
  try {
    if (storage?.getItem(UI_SOUND_STORAGE_KEY_V2) === 'off') enabled = false;
  } catch { /* Keep the default enabled when preference storage is unavailable. */ }

  let audioContext = null;
  let lastCueAt = 0;
  let lastToastText = '';
  const pendingCues = new Set();
  const observedDialogState = new WeakMap();
  const activeObserver = typeof windowRef.MutationObserver === 'function'
    ? new windowRef.MutationObserver((records) => {
      const changedDialogs = new Set(records.map((record) => record.target).filter((target) => target?.tagName === 'DIALOG'));
      for (const dialog of changedDialogs) {
        const wasOpen = observedDialogState.get(dialog) === true;
        const isOpen = dialog.open === true;
        observedDialogState.set(dialog, isOpen);
        if (!wasOpen && isOpen) scheduleCue('dialog');
      }

      const toast = documentRef.getElementById('toast');
      if (toast && records.some((record) => record.target === toast || toast.contains(record.target))) {
        const message = toast.textContent.trim();
        if (message && message !== lastToastText && toast.classList.contains('is-visible')) {
          lastToastText = message;
          const tone = toast.dataset.tone;
          scheduleCue(tone === 'success' ? 'success' : tone === 'error' ? 'error' : 'info');
        }
      }
    })
    : null;

  function mediaIsPlaying() {
    try {
      return [...documentRef.querySelectorAll('audio, video')].some((media) => !media.paused && !media.ended && !media.muted && media.volume > 0);
    } catch { return false; }
  }

  function getAudioContext() {
    if (audioContext) return audioContext;
    const AudioContextClass = windowRef.AudioContext || windowRef.webkitAudioContext;
    if (typeof AudioContextClass !== 'function') return null;
    try { audioContext = new AudioContextClass(); } catch { audioContext = null; }
    return audioContext;
  }

  function playCue(name) {
    if (!canPlayUiSoundV2({ enabled, pageHidden: documentRef.visibilityState === 'hidden', mediaPlaying: mediaIsPlaying() })) return;
    const now = Date.now();
    if (now - lastCueAt < 85) return;
    lastCueAt = now;

    const context = getAudioContext();
    if (!context) return;
    if (context.state === 'suspended') void context.resume().catch(() => {});
    const cue = CUES[name] || CUES.click;
    const origin = context.currentTime + 0.006;
    for (const [frequency, offset, duration] of cue) {
      try {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const start = origin + offset;
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(frequency, start);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.016, start + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
        oscillator.start(start);
        oscillator.stop(start + duration + 0.012);
      } catch { /* Audio is an optional enhancement; UI actions never depend on it. */ }
    }
  }

  function scheduleCue(name) {
    const timer = setTimeout(() => {
      pendingCues.delete(timer);
      playCue(name);
    }, 100);
    pendingCues.add(timer);
  }

  function syncToggle() {
    toggle.setAttribute('aria-pressed', String(enabled));
    toggle.setAttribute('aria-label', `Interface sounds ${enabled ? 'on' : 'off'}`);
    toggle.title = `Interface sounds ${enabled ? 'on' : 'off'}`;
    const state = documentRef.getElementById('sound-toggle-state');
    if (state) state.textContent = enabled ? 'On' : 'Off';
    toggle.classList.toggle('is-off', !enabled);
  }

  function handleToggle() {
    enabled = !enabled;
    try { storage?.setItem(UI_SOUND_STORAGE_KEY_V2, enabled ? 'on' : 'off'); } catch { /* The current choice still applies for this page. */ }
    syncToggle();
    if (enabled) playCue('click');
  }

  const onToggle = () => handleToggle();
  const onDocumentClick = (event) => {
    const button = event.target?.closest?.('button');
    if (!button || button.disabled || button === toggle) return;
    if (button.matches('.nav-link, .profile-dropdown-link[data-view]')) return;
    playCue('click');
  };
  const onHashChange = () => playCue('navigate');

  toggle.addEventListener('click', onToggle);
  documentRef.addEventListener('click', onDocumentClick);
  windowRef.addEventListener('hashchange', onHashChange);

  if (activeObserver) {
    documentRef.querySelectorAll('dialog').forEach((dialog) => observedDialogState.set(dialog, dialog.open === true));
    activeObserver.observe(documentRef.body, { attributes: true, attributeFilter: ['open'], subtree: true });
    const toast = documentRef.getElementById('toast');
    if (toast) activeObserver.observe(toast, { attributes: true, characterData: true, childList: true, subtree: true });
  }
  syncToggle();

  return () => {
    toggle.removeEventListener('click', onToggle);
    documentRef.removeEventListener('click', onDocumentClick);
    windowRef.removeEventListener('hashchange', onHashChange);
    activeObserver?.disconnect();
    for (const timer of pendingCues) clearTimeout(timer);
    pendingCues.clear();
    if (audioContext && audioContext.state !== 'closed') void audioContext.close().catch(() => {});
  };
}
