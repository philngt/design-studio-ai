import { z } from 'zod';

const text = z.string().trim().min(1).max(1000);
const shortText = z.string().trim().min(1).max(240);
const list = z.array(text).max(24);

export const strategyTargetSchema = z.enum(['web', 'mobile', 'tablet', 'desktop']);
export type StrategyTarget = z.infer<typeof strategyTargetSchema>;

export const designStrategyBodySchema = z.object({
  userJob: z.object({
    primary: text,
    secondary: list,
  }).strict(),
  businessGoal: z.object({
    primary: text,
    secondary: list,
  }).strict(),
  evidence: z.object({
    facts: list,
    measurements: list,
    assumptions: list,
  }).strict(),
  mechanisms: z.array(z.object({
    observation: text,
    mechanism: text,
    principle: text,
  }).strict()).min(1).max(16),
  informationHierarchy: z.object({
    primary: list,
    secondary: list,
    contextual: list,
    rare: list,
  }).strict(),
  attentionStrategy: z.array(text).min(1).max(16),
  navigationStrategy: z.array(text).min(1).max(16),
  interactionStrategy: z.array(text).min(1).max(16),
  layoutStrategy: z.object({
    model: shortText,
    density: z.enum(['focused', 'medium', 'dense']),
    grouping: z.array(text).min(1).max(16),
  }).strict(),
  visualStrategy: z.object({
    focalSurface: text,
    contrast: text,
    brandPresence: z.enum(['low', 'medium', 'high']),
    illustrationRole: text,
  }).strict(),
  platformAdaptation: z.array(z.object({
    target: strategyTargetSchema,
    decisions: z.array(text).min(1).max(16),
  }).strict()).min(1).max(4),
  alternatives: z.array(z.object({
    id: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
    name: shortText,
    summary: text,
    tradeoffs: z.array(text).min(1).max(12),
  }).strict()).min(2).max(5),
  decision: z.object({
    selectedAlternativeId: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
    rationale: z.array(text).min(1).max(12),
    rejected: z.array(text).max(12),
  }).strict(),
  successCriteria: z.array(text).min(1).max(16),
  validationPlan: z.array(text).min(1).max(16),
}).strict().superRefine((value, ctx) => {
  const ids = new Set(value.alternatives.map(item => item.id));
  if (ids.size !== value.alternatives.length)
    ctx.addIssue({ code: 'custom', path: ['alternatives'], message: 'Alternative ids must be unique.' });
  if (!ids.has(value.decision.selectedAlternativeId))
    ctx.addIssue({ code: 'custom', path: ['decision', 'selectedAlternativeId'], message: 'Decision must select one of the declared alternatives.' });
  const targets = new Set(value.platformAdaptation.map(item => item.target));
  if (targets.size !== value.platformAdaptation.length)
    ctx.addIssue({ code: 'custom', path: ['platformAdaptation'], message: 'Platform adaptations must have unique targets.' });
});

export const designStrategySchema = designStrategyBodySchema.extend({
  schemaVersion: z.literal('design-strategy.v1'),
  projectId: z.string().min(1).max(128),
  revision: z.number().int().min(1),
  sourceBriefRevision: z.number().int().min(1),
  status: z.enum(['draft', 'approved']),
  approvedAt: z.string().nullable(),
  updatedAt: z.string(),
}).strict();

export type DesignStrategyBody = z.infer<typeof designStrategyBodySchema>;
export type DesignStrategy = z.infer<typeof designStrategySchema>;

export const designStrategyGenerateSchema = z.object({
  expectedRevision: z.number().int().min(0),
  expectedBriefRevision: z.number().int().min(1),
  provider: z.string().min(1).max(80),
  model: z.string().trim().min(1).max(200).optional(),
}).strict();

export const designStrategyWriteSchema = z.object({
  expectedRevision: z.number().int().min(0),
  expectedBriefRevision: z.number().int().min(1),
  strategy: designStrategyBodySchema,
}).strict();

export const designStrategyApprovalSchema = z.object({
  expectedRevision: z.number().int().min(1),
  expectedBriefRevision: z.number().int().min(1),
}).strict();
