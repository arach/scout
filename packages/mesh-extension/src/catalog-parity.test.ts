import { expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { SCOUT_MCP_CORE_TOOL_NAMES } from '@openscout/protocol';
import { createScoutMcpServer } from '../../../apps/desktop/src/core/mcp/scout-mcp.ts';
import { selectCoreTools } from './core-http-mcp.ts';
function wire(value:any):any {
  if(Array.isArray(value))return value.map(wire);
  if(value && typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!['description','title','additionalProperties'].includes(key)).map(([key,v])=>[key,wire(v)]));
  return value;
}
test('all 24 HTTP tool argument schemas retain the existing public core wire types',async()=>{
  const server=createScoutMcpServer({defaultCurrentDirectory:'/',env:{},toolFilter:n=>SCOUT_MCP_CORE_TOOL_NAMES.includes(n as never)});
  const client=new Client({name:'parity',version:'1'});const[a,b]=InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(a),client.connect(b)]);const current=(await client.listTools()).tools;
    for(const tool of selectCoreTools())expect({name:tool.name,schema:wire(tool.inputSchema)}).toEqual({name:tool.name,schema:wire(current.find(v=>v.name===tool.name)!.inputSchema)});
  } finally {await client.close();await server.close();}
});
