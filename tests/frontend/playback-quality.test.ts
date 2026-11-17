import assert from 'node:assert/strict';
import { test } from 'node:test';
import { preferredPlaybackQuality } from '../../client/utils/playbackQuality';

test('streaming respects the initial quality preference without depending on option order', () => {
  const qualities = [
    { id: 'high-id', label: '1080 (mp4)', bytes: 100 },
    { id: 'low-id', label: '360p', bytes: 200 },
  ];
  assert.equal(preferredPlaybackQuality(qualities, 'auto'), undefined);
  assert.equal(preferredPlaybackQuality(qualities, 'low'), 'low-id');
  assert.equal(preferredPlaybackQuality(qualities, 'high'), 'high-id');
});

test('streaming falls back to file sizes or the first listed quality when resolution is unknown', () => {
  const qualities = [
    { id: 'a', label: 'Main', bytes: 200 },
    { id: 'b', label: 'Alternate', bytes: 100 },
  ];
  assert.equal(preferredPlaybackQuality(qualities, 'low'), 'b');
  assert.equal(preferredPlaybackQuality([{ id: 'a', label: 'Main' }, qualities[1]], 'low'), 'a');
  assert.equal(preferredPlaybackQuality([], 'high'), undefined);
});
