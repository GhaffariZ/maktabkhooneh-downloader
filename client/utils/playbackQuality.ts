import type { Quality } from '@shared/types';
import type { QualityPreference } from './studyPreferences';

function resolution(quality: Quality): number | undefined {
  const label = `${quality.label} ${quality.id}`;
  const match = label.match(/\b(144|240|360|480|540|576|720|1080|1440|2160|4320)p?\b/i);
  if (match) return Number(match[1]);
  if (/\b(hq|hd)\b/i.test(label)) return 720;
  if (/\b(lq|sd)\b/i.test(label)) return 360;
}

export function preferredPlaybackQuality(
  qualities: Quality[],
  preference: QualityPreference,
): string | undefined {
  if (preference === 'auto') return undefined;

  const sizes = qualities.map((quality) => quality.bytes);
  const resolutions = qualities.map(resolution);
  const ranks = resolutions.every((rank) => rank !== undefined) ? resolutions : sizes;
  if (!ranks.every((rank): rank is number => rank !== undefined && Number.isFinite(rank) && rank > 0)) {
    return qualities[0]?.id;
  }

  let best = 0;
  for (let i = 1; i < ranks.length; i++) {
    const candidate = ranks[i];
    const current = ranks[best];
    if (preference === 'low' ? candidate < current : candidate > current) best = i;
  }
  return qualities[best]?.id;
}
