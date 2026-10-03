import test from 'node:test';
import assert from 'node:assert/strict';
import { canPlayUiSoundV2, UI_SOUND_STORAGE_KEY_V2 } from '../ui-effects-v2.js';

test('UI sound preference is separately persisted and can be muted', () => {
  assert.equal(UI_SOUND_STORAGE_KEY_V2, 'listr-ui-sounds-v2');
  assert.equal(canPlayUiSoundV2({ enabled: true }), true);
  assert.equal(canPlayUiSoundV2({ enabled: false }), false);
});

test('UI sounds are suppressed while the page is hidden or other media is playing', () => {
  assert.equal(canPlayUiSoundV2({ enabled: true, pageHidden: true }), false);
  assert.equal(canPlayUiSoundV2({ enabled: true, mediaPlaying: true }), false);
  assert.equal(canPlayUiSoundV2({ enabled: false, pageHidden: false, mediaPlaying: false }), false);
  assert.equal(canPlayUiSoundV2({ enabled: true, pageHidden: false, mediaPlaying: false }), true);
});
