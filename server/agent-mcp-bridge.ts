// Launched only by the Node agent runtime. The credential is scoped to one turn.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { agentTools, agentToolRegistrationSchemas } from '../src/shared/agents';

const server = new McpServer({ name: 'studio-draft', version: '1.0.0' });
for (const [name, definition] of Object.entries(agentTools)) {
  server.registerTool(name, { description: definition.description, inputSchema: agentToolRegistrationSchemas[name as keyof typeof agentTools].shape }, async (input: any) => {
    const response = await fetch(process.env.STUDIO_DRAFT_URL!, { method:'POST', redirect:'error', headers:{'Content-Type':'application/json',Authorization:`Bearer ${process.env.STUDIO_DRAFT_TOKEN}`},body:JSON.stringify({name,input}) });
    return { content:[{type:'text' as const,text:await response.text()}], ...(!response.ok?{isError:true}:{}) };
  });
}
await server.connect(new StdioServerTransport());
