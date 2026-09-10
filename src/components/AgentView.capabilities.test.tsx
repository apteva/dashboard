import { afterEach, expect, mock, test } from 'bun:test';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { core, integrations, mcpServers, type AppRow, type MCPServer, type MCPServerConfig } from '../api';
import { CapabilitiesManager } from './AgentView';
const originals = {list: mcpServers.list, connections: integrations.connections, config: core.config, mutate: core.mutateMCPServers};
afterEach(() => { cleanup(); mcpServers.list=originals.list; integrations.connections=originals.connections; core.config=originals.config; core.mutateMCPServers=originals.mutate; });
const inventory = [
 {id:1,name:'tasks',source:'app',description:'Tasks',tool_count:3,proxy_config:{name:'tasks',transport:'http',url:'https://example.test/tasks'}},
 {id:2,name:'github-account',source:'local',description:'GitHub',connection_id:9,tool_count:4,proxy_config:{name:'github-account',transport:'http',url:'https://example.test/github'}},
 {id:3,name:'local-search',source:'custom',description:'Local search',tool_count:2,proxy_config:{name:'local-search',transport:'http',url:'https://example.test/search'}},
] as MCPServer[];
const apps = [{install_id:1,name:'tasks',display_name:'Tasks',project_id:'p',version:'1.0',description:'Track work',icon:'/tasks.svg',surfaces:{mcp_tool_count:3}}] as AppRow[];
function setup(initial: MCPServerConfig[] = []) {
 let saved=initial;
 mcpServers.list=mock(async()=>inventory);
 integrations.connections=mock(async()=>[{id:9,app_name:'GitHub',name:'Work account',logo:'/github.svg'}] as any);
 core.config=mock(async()=>({mcp_servers:saved}) as any);
 core.mutateMCPServers=mock(async(_id,ids,action)=> {saved= action==='add' ? [inventory.find(r=>r.id===ids[0])!.proxy_config as MCPServerConfig] : []; return {} as any;});
 function Fixture() {
  const [attached,setAttached]=useState(initial); const [rows,setRows]=useState(inventory);
  return <CapabilitiesManager instanceId={1103} projectId="p" attached={attached} apps={apps} inventory={rows} onAttachedChange={setAttached} onInventoryChange={setRows}/>;
 }
 render(<Fixture/>);
}
test('opens on a focused attached overview and browses one category at a time',async()=>{
 setup([inventory[0].proxy_config as MCPServerConfig]);
 expect(screen.getAllByRole('checkbox')).toHaveLength(1);
 expect(screen.getByRole('checkbox',{name:/Tasks/}).getAttribute('aria-checked')).toBe('true');
 fireEvent.click(screen.getByRole('button',{name:'Integrations 1'}));
 await waitFor(()=>expect(screen.getByRole('checkbox',{name:/GitHub Work account/})).toBeTruthy());
 expect(screen.queryByRole('checkbox',{name:/Tasks/})).toBeNull();
 expect(screen.getByRole('checkbox',{name:/GitHub Work account/}).querySelector('img')?.getAttribute('src')).toBe('/github.svg');
 fireEvent.click(screen.getByRole('button',{name:'MCP servers 1'}));
 expect(screen.getByRole('checkbox',{name:/Local search/})).toBeTruthy();
 expect(screen.queryByRole('checkbox',{name:/GitHub/})).toBeNull();
});
test('searches apps and attaches/removes through the existing API',async()=>{
 setup();
 await waitFor(()=>expect(screen.getByText('No capabilities attached yet.')).toBeTruthy());
 fireEvent.click(screen.getByRole('button',{name:'+ Add apps'}));
 fireEvent.change(screen.getByRole('textbox',{name:'Search capabilities'}),{target:{value:'no match'}});
 expect(screen.queryByRole('checkbox')).toBeNull();
 fireEvent.change(screen.getByRole('textbox',{name:'Search capabilities'}),{target:{value:'Tasks'}});
 const option=screen.getByRole('checkbox',{name:/Tasks/});
 expect(option.textContent).toContain('Project app · v1.0');
 fireEvent.click(option);
 await waitFor(()=>expect(option.getAttribute('aria-checked')).toBe('true'));
 expect(core.mutateMCPServers).toHaveBeenCalledWith(1103,[1],'add');
 fireEvent.click(option);
 await waitFor(()=>expect(option.getAttribute('aria-checked')).toBe('false'));
 expect(core.mutateMCPServers).toHaveBeenCalledWith(1103,[1],'remove');
});
test('a failed attachment remains unselected and shows the error',async()=>{
 setup();
 core.mutateMCPServers=mock(async()=>{throw new Error('Unable to attach');});
 fireEvent.click(screen.getByRole('button',{name:'Apps 1'}));
 fireEvent.click(screen.getByRole('checkbox',{name:/Tasks/}));
 await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('Unable to attach'));
 expect(screen.getByRole('checkbox',{name:/Tasks/}).getAttribute('aria-checked')).toBe('false');
});
