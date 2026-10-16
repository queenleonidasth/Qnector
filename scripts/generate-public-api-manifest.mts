import {toolDefinitions} from '../packages/tools/src/index.ts';
import {writeFileSync} from 'node:fs';
const data={baselineCommit:'e809591d9cceca0140c9cc66fdcf7b4dc62be0f6',tools:toolDefinitions.map(t=>({name:t.name,actions:(t.inputSchema.properties as any)?.action?.enum??[],required:(t.inputSchema.required as string[]??[]),properties:Object.keys((t.inputSchema.properties as object)??{}),permissionHints:t.annotations,legacyCallShape:'{action,...action-specific fields}'})),hostAliases:[
{name:'system.timeout_probe',actions:['probe'],required:['durationSec'],permissionHints:{readOnlyHint:true,destructiveHint:false}},
{name:'tasks',actions:['start','get','list','wait','output','result','cancel','inspect','doctor','overview','lookup'],required:['action'],permissionHints:{readOnlyHint:false,destructiveHint:true}}
]};
writeFileSync('fixtures/performance/manifest.json',JSON.stringify(data,null,2)+'\n');
