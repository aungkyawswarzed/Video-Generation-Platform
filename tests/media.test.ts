import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMediaMime } from '../src/lib/media';
test('M4A, WAV, and Opus signatures normalize to supported media types', () => {
  assert.equal(normalizeMediaMime('audio/x-m4a'), 'audio/mp4');
  assert.equal(normalizeMediaMime('audio/x-wav'), 'audio/wav');
  assert.equal(normalizeMediaMime('audio/ogg; codecs=opus'), 'audio/ogg');
  assert.equal(normalizeMediaMime('video/mp4'), 'video/mp4');
});
