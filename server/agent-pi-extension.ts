import { z } from 'zod';
import { agentTools, agentToolRegistrationSchemas, agentToolNames } from '../src/shared/agents';

// Structural extension interface keeps Pi's CLI package out of the web/Worker build.
export default function studioDraftExtension(pi: { registerTool(tool: unknown): void }) {
  for (const name of agentToolNames(process.env.STUDIO_AGENT_PURPOSE === 'interview' ? 'interview' : 'design')) pi.registerTool({
    name, label:name, description:agentTools[name].description, parameters:z.toJSONSchema(agentToolRegistrationSchemas[name as keyof typeof agentTools]),
    async execute(_id:string,input:unknown) {
      const response=await fetch(process.env.STUDIO_DRAFT_URL!,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Authorization:`Bearer ${process.env.STUDIO_DRAFT_TOKEN}`},body:JSON.stringify({name,input})});
      const text=await response.text();
      if(!response.ok)throw new Error(text);
      return {content:[{type:'text',text}],details:{}};
    },
  });
}
