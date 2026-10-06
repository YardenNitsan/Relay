import { z } from 'zod';

/** Every profile respects these floors, including custom settings from persisted JSON. */
export const resourcePolicyBounds = Object.freeze({
  ramReserveGiB: Object.freeze({ min: 2, max: 256 }),
  ramReservePercent: Object.freeze({ min: 10, max: 75 }),
  vramReserveGiB: Object.freeze({ min: 1, max: 256 }),
  vramReservePercent: Object.freeze({ min: 10, max: 75 }),
});
const limit = (bounds: { min: number; max: number }) => z.number().finite().min(bounds.min).max(bounds.max);
export const resourcePolicySchema = z.discriminatedUnion('profile', [
  z.object({ profile: z.literal('safe') }).strict(),
  z.object({ profile: z.literal('balanced') }).strict(),
  z.object({ profile: z.literal('performance') }).strict(),
  z.object({ profile: z.literal('custom'), ramReserveGiB: limit(resourcePolicyBounds.ramReserveGiB), ramReservePercent: limit(resourcePolicyBounds.ramReservePercent), vramReserveGiB: limit(resourcePolicyBounds.vramReserveGiB), vramReservePercent: limit(resourcePolicyBounds.vramReservePercent) }).strict(),
]);
export type ResourcePolicyConfig = z.infer<typeof resourcePolicySchema>;
export interface ResourcePolicy {
  profile: ResourcePolicyConfig['profile'];
  ramReserveGiB: number;
  ramReservePercent: number;
  vramReserveGiB: number;
  vramReservePercent: number;
}
const presets = Object.freeze({
  safe: Object.freeze({ ramReserveGiB: 4, ramReservePercent: 20, vramReserveGiB: 1, vramReservePercent: 15 }),
  balanced: Object.freeze({ ramReserveGiB: 3, ramReservePercent: 15, vramReserveGiB: 1, vramReservePercent: 12 }),
  performance: Object.freeze({ ramReserveGiB: 2, ramReservePercent: 10, vramReserveGiB: 1, vramReservePercent: 10 }),
});
const labels = { safe: 'Safe', balanced: 'Balanced', performance: 'Performance', custom: 'Custom' } as const;
const descriptions = {
  safe: 'Preserve more memory for the operating system and other applications. Default.',
  balanced: 'Use moderate memory reserves while retaining enforced safety floors.',
  performance: 'Allow more model memory with the minimum supported reserves. May reduce responsiveness.',
  custom: 'Set explicit reserves within enforced safety limits.',
} as const;

export function resolveResourcePolicy(value?: unknown): ResourcePolicy {
  const config = resourcePolicySchema.parse(value === undefined ? { profile: 'safe' } : value);
  return config.profile === 'custom' ? { ...config } : { ...presets[config.profile], profile: config.profile };
}

export function resourceProfiles(): (ResourcePolicy & { label: string; description: string })[] {
  return (['safe', 'balanced', 'performance', 'custom'] as const).map(profile => ({ ...resolveResourcePolicy(profile === 'custom' ? { profile, ...presets.safe } : { profile }), label: labels[profile], description: descriptions[profile] }));
}

export function reserveBytes(totalBytes: number, minimumGiB: number, minimumPercent: number): number {
  return Math.ceil(Math.max(minimumGiB * 1024 ** 3, totalBytes * minimumPercent / 100));
}

export function resourcePolicyReason(policy: ResourcePolicy): string {
  return `${labels[policy.profile]} resource policy reserves the greater of ${policy.ramReserveGiB} GiB or ${policy.ramReservePercent}% of physical RAM, and ${policy.vramReserveGiB} GiB or ${policy.vramReservePercent}% of discrete VRAM.`;
}
