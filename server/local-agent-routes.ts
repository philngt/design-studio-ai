import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from './types';
import { generationInputSchema } from '../src/shared/provider-requests';
import { localAgentFromProviderId } from '../src/shared/local-agents';
import { documentSchema } from '../src/shared/schema';
import { motionProposalContext, motionProposalSchema, parseMotionProposal } from '../src/shared/motion-proposal';
import { mutateDocument } from '../src/shared/operations';
import type { DesignBrief } from '../src/shared/brief';
import { fail, owner } from './security';
import { projectRow, validateAssets } from './projects';
import { canUseLocalAgentBridge, localAgentBridgeEnabled, requireLocalAgentBridge, runLocalAgentProvider } from './local-agent-access';

const generateSchema = generationInputSchema.extend({
  projectId: z.string().min(1).max(120),
}).strict();

export const localAgentRoutes = new Hono<Env>();

localAgentRoutes.get('/', async c => {
  const enabled = localAgentBridgeEnabled(c);
  const authorized = enabled && await canUseLocalAgentBridge(c);
  const runtimes = authorized ? await c.env.AGENT_RUNNER!.list().catch(() => []) : [];
  return c.json({ enabled, authorized, runtimes });
});

localAgentRoutes.post('/generate', async c => {
  const body = generateSchema.parse(await c.req.json());
  if (!localAgentFromProviderId(body.provider))
    fail(400, 'unsupported_agent', 'Choose Codex or Claude Code for local agent generation.');
  await requireLocalAgentBridge(c);
  const row = await projectRow(c, body.projectId);
  if (body.expectedRevision !== row.revision)
    fail(409, 'revision_conflict', 'Reload the project before generating.');

  const savedBrief = await c.env.DB.prepare('SELECT brief,revision FROM design_briefs WHERE project_id=? AND user_id=?')
    .bind(row.id, owner(c))
    .first<{ brief: string; revision: number }>();
  const brief = savedBrief ? JSON.parse(savedBrief.brief) as DesignBrief : null;
  if (brief && (brief.status !== 'approved' || !brief.scope || !brief.approvedAt))
    fail(409, 'brief_not_approved', 'Review and explicitly approve the project scope before generating.');

  const current = documentSchema.parse(JSON.parse(row.document));
  const motion = body.mode === 'motion' || (body.mode !== 'document' && !!current.characters?.length);
  const system = 'You edit canonical DesignDocument v1 or v2 JSON, preserving the input schemaVersion. For v2 preserve all boards, paintings, asset IDs, layer manifests and generation identities unless explicitly instructed. Never fabricate paint pixel hashes or composites; pixel changes require owned PNG tiles. Return only the complete valid document, no prose or markdown. Preserve id and kind and existing useful content unless asked. Nodes have finite pixel x,y,width,height; type frame,group,component,text,image,shape,icon,chart,model3d,video,audio,board,artwork. Prefer structured flex/grid page and container layout for Web/App designs: layout has mode, direction row/column, gap,padding,align,justify,wrap,columns. sizing width/height uses fixed/hug/fill. Explicit absolute containers use local child coordinates; containers with no layout keep legacy page-space coordinates. Components use component:{name,system:antd or shadcn,props:{label,...}}; available names Button,Checkbox,Input,InputNumber,Slider,Image,Avatar,List,Statistics,Chart,Table,Select,Switch,Textarea,Card,Badge,Progress,Tabs,Dialog,Radio. Parent IDs must exist on the same page. Text belongs in text, styles in style. Timeline keyframes support linear,easeIn,easeOut,easeInOut,bounce,spring,step or a cubic bezier tuple. Mesh geometry/UV/materials/bones belong in scene; preserve existing mesh data unless specifically editing it. Never return executable code, scripts, event handlers, or javascript URLs. Preserve schemaVersion, theme, pages, assets and metadata. '
    + (brief ? `The user explicitly approved this scope. Fulfill its objective, audience, direction, deliverables, constraints and acceptance criteria: ${JSON.stringify(brief.scope)}. ` : '')
    + 'Current document: ' + row.document;
  const motionContext = motionProposalContext(current);
  const motionSystem = 'Return only a JSON array of bounded document operations. Preserve all unrelated artwork, keys, skins and IDs. Build editable bones, clips and constraints; never return code. Existing assets only. The user will review before applying. Operations schema: '
    + JSON.stringify(z.toJSONSchema(motionProposalSchema))
    + ' Current approved scope: ' + JSON.stringify(brief?.scope ?? null)
    + ' Current document (media URLs omitted): ' + JSON.stringify(motionContext);

  const result = await runLocalAgentProvider(c, body.provider, {
    system: motion ? motionSystem : system,
    prompt: body.prompt,
    ...(body.model ? { model: body.model } : {}),
    outputSchema: z.toJSONSchema(motion ? motionProposalSchema : documentSchema),
  });

  const currentBrief = await c.env.DB.prepare('SELECT revision FROM design_briefs WHERE project_id=? AND user_id=?')
    .bind(row.id, owner(c))
    .first<{ revision: number }>();
  if ((currentBrief?.revision ?? 0) !== (savedBrief?.revision ?? 0))
    fail(409, 'revision_conflict', 'The brief changed during generation. Review its latest scope before generating again.');

  let draft: unknown;
  try {
    draft = JSON.parse(result.output.replace(/^\s*```(?:json)?\s*/, '').replace(/\s*```\s*$/, ''));
  } catch {
    fail(502, 'invalid_generation', 'The local agent did not return valid JSON. Your project was not changed.');
  }

  let operations: unknown;
  if (motion) {
    try {
      operations = parseMotionProposal(current, draft);
      draft = mutateDocument(current, operations);
    } catch {
      fail(502, 'invalid_generation', 'Local agent motion operations failed validation. Your project was not changed.');
    }
  }
  const parsed = documentSchema.safeParse(draft);
  if (!parsed.success)
    fail(502, 'invalid_generation', 'The local agent proposal failed document validation. Your project was not changed.');
  if (parsed.data.id !== row.id || parsed.data.kind !== row.kind)
    fail(502, 'invalid_generation', 'The local agent changed document identity. Your project was not changed.');
  if (parsed.data.schemaVersion < current.schemaVersion)
    fail(502, 'invalid_generation', 'The local agent downgraded the document schema.');
  if ((await projectRow(c, row.id)).revision !== row.revision)
    fail(409, 'revision_conflict', 'Project changed during generation.');
  await validateAssets(c, parsed.data, row.id);

  return c.json({
    document: parsed.data,
    operations,
    baseRevision: row.revision,
    baseBriefRevision: savedBrief?.revision ?? 0,
    agent: {
      id: localAgentFromProviderId(body.provider),
      durationMs: result.durationMs,
      version: result.version ?? null,
    },
  });
});
