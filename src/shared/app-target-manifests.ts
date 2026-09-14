import { z } from 'zod';

export const appTargetIds = ['mobile', 'tablet', 'desktop'] as const;
export type AppTarget = typeof appTargetIds[number];

const canvasSchema = z.object({
  width: z.number().int().min(1).max(20000),
  height: z.number().int().min(1).max(20000),
}).strict();

const capabilitiesSchema = z.object({
  touch: z.boolean(),
  pointer: z.boolean(),
  keyboard: z.boolean(),
  pencil: z.boolean(),
  hover: z.boolean(),
  multiWindow: z.boolean(),
}).strict();

const layoutSchema = z.object({
  model: z.enum(['single-context', 'multi-pane', 'workspace']),
  density: z.enum(['focused', 'balanced', 'dense']),
  persistentRegions: z.array(z.string().min(1).max(80)).max(8),
}).strict();

export const appTargetManifestSchema = z.object({
  version: z.literal(1),
  target: z.enum(appTargetIds),
  label: z.string().min(1).max(40),
  canvas: canvasSchema,
  capabilities: capabilitiesSchema,
  layout: layoutSchema,
  navigation: z.array(z.string().min(1).max(120)).min(1).max(8),
  interaction: z.array(z.string().min(1).max(160)).min(1).max(10),
  strategy: z.array(z.string().min(1).max(240)).min(1).max(12),
}).strict();
export type AppTargetManifest = z.infer<typeof appTargetManifestSchema>;

export const appTargetManifests: Record<AppTarget, AppTargetManifest> = {
  mobile: {
    version: 1,
    target: 'mobile',
    label: 'Mobile',
    canvas: { width: 393, height: 852 },
    capabilities: { touch: true, pointer: false, keyboard: false, pencil: false, hover: false, multiWindow: false },
    layout: { model: 'single-context', density: 'focused', persistentRegions: ['content', 'bottom navigation'] },
    navigation: ['stack navigation', 'tab bar', 'sheet for secondary tasks'],
    interaction: ['touch-first', 'large reachable targets', 'progressive disclosure', 'short focused flows'],
    strategy: [
      'Prioritize one primary task and one primary context at a time.',
      'Keep primary actions immediately reachable; defer secondary controls.',
      'Prefer vertical flow and progressive disclosure over persistent secondary panes.',
      'Design for interruption, short sessions, and one-handed touch where practical.',
    ],
  },
  tablet: {
    version: 1,
    target: 'tablet',
    label: 'Tablet',
    canvas: { width: 1024, height: 1366 },
    capabilities: { touch: true, pointer: true, keyboard: true, pencil: true, hover: true, multiWindow: true },
    layout: { model: 'multi-pane', density: 'balanced', persistentRegions: ['sidebar', 'primary content', 'contextual detail'] },
    navigation: ['sidebar', 'split view', 'master-detail', 'contextual sheet or inspector'],
    interaction: ['touch remains first-class', 'pointer and keyboard are additive', 'drag and drop where it improves direct manipulation', 'multi-selection when the task benefits'],
    strategy: [
      'Do not scale a phone layout up; use the extra space to preserve useful context.',
      'Prefer sidebar, split-view, or master-detail structures when simultaneous context reduces navigation cost.',
      'Support touch without penalizing keyboard and pointer workflows.',
      'Adapt gracefully to narrower multitasking widths rather than assuming full-screen use.',
    ],
  },
  desktop: {
    version: 1,
    target: 'desktop',
    label: 'Desktop',
    canvas: { width: 1440, height: 900 },
    capabilities: { touch: false, pointer: true, keyboard: true, pencil: false, hover: true, multiWindow: true },
    layout: { model: 'workspace', density: 'dense', persistentRegions: ['sidebar', 'toolbar', 'primary workspace', 'inspector'] },
    navigation: ['sidebar', 'toolbar', 'menus', 'inspector', 'multiple windows when tasks are independent'],
    interaction: ['pointer precision', 'keyboard shortcuts', 'hover affordances as enhancement', 'context menus', 'multi-selection'],
    strategy: [
      'Optimize for sustained work, repeated commands, and high information visibility.',
      'Use persistent controls and context when they reduce repeated navigation.',
      'Provide keyboard-efficient paths for frequent actions while keeping pointer discoverability.',
      'Use denser layouts only when hierarchy remains scannable and state remains understandable.',
    ],
  },
};

export const appManifestSchema = z.object({
  targets: z.array(z.enum(appTargetIds)).min(1).max(appTargetIds.length),
  manifests: z.array(appTargetManifestSchema).min(1).max(appTargetIds.length),
}).strict().superRefine((app, context) => {
  if (new Set(app.targets).size !== app.targets.length)
    context.addIssue({ code: 'custom', path: ['targets'], message: 'App targets must be unique.' });
  const manifestTargets = app.manifests.map(manifest => manifest.target);
  if (new Set(manifestTargets).size !== manifestTargets.length)
    context.addIssue({ code: 'custom', path: ['manifests'], message: 'Each app target needs one manifest.' });
  if (app.targets.length !== manifestTargets.length || app.targets.some(target => !manifestTargets.includes(target)))
    context.addIssue({ code: 'custom', path: ['manifests'], message: 'App manifests must match the selected targets exactly.' });
});

export type AppManifest = z.infer<typeof appManifestSchema>;

export function normalizeAppTargets(targets: readonly AppTarget[] | undefined): AppTarget[] {
  const selected = new Set(targets?.length ? targets : ['mobile']);
  return appTargetIds.filter(target => selected.has(target));
}

export function buildAppManifest(targets?: readonly AppTarget[]): AppManifest {
  const normalized = normalizeAppTargets(targets);
  return {
    targets: normalized,
    manifests: normalized.map(target => structuredClone(appTargetManifests[target])),
  };
}
