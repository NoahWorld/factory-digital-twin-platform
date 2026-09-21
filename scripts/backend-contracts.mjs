// Transitional contract export: TypeScript is the existing source of truth.
// Generated JSON Schema is consumed by Java. Semantic/reference checks remain server responsibilities.
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('..',import.meta.url));
const require=createRequire(new URL('../apps/web/package.json',import.meta.url));
const ts=require('typescript');
const files=['apps/api/src/canvas.ts','apps/api/src/standalone-scenes.ts','apps/api/src/assets.ts','apps/api/src/data-sources.ts','apps/api/src/asset-data-bindings.ts','shared/canvas-ornaments.ts'];
const program=ts.createProgram(files.map(f=>join(root,f)),{strict:true,target:ts.ScriptTarget.ES2022,skipLibCheck:true,moduleResolution:ts.ModuleResolutionKind.Node10});
const checker=program.getTypeChecker();
const aliases=new Map();
for(const source of program.getSourceFiles())if(source.fileName.startsWith(root)&&!source.fileName.includes('node_modules'))for(const statement of source.statements)if(ts.isTypeAliasDeclaration(statement))aliases.set(statement.name.text,checker.getTypeAtLocation(statement));
const definitions={};const pending=new Set();
function schema(t,inline=false){
  const name=t.aliasSymbol?.name;
  if(name&&!inline&&aliases.has(name)&&!['Record','JsonObject'].includes(name)){
    if(!pending.has(name)){pending.add(name);definitions[name]=schema(t,true);}
    return {$ref:'#/definitions/'+name};
  }
  if(t.isUnion())return {anyOf:t.types.filter(t=>!(t.flags&ts.TypeFlags.Undefined)).map(t=>schema(t))};
  if(t.flags&ts.TypeFlags.StringLiteral)return {const:t.value};
  if(t.flags&ts.TypeFlags.NumberLiteral)return {const:t.value};
  if(t.flags&ts.TypeFlags.BooleanLiteral)return {const:t.intrinsicName==='true'};
  if(t.flags&ts.TypeFlags.String)return {type:'string',maxLength:8192};
  if(t.flags&ts.TypeFlags.Number)return {type:'number'};
  if(t.flags&ts.TypeFlags.Boolean)return {type:'boolean'};
  if(t.flags&ts.TypeFlags.Null)return {type:'null'};
  if(t.flags&(ts.TypeFlags.Any|ts.TypeFlags.Unknown))return {};
  if(checker.isTupleType(t)){const items=checker.getTypeArguments(t).map(t=>schema(t));return {type:'array',items,minItems:items.length,maxItems:items.length};}
  if(checker.isArrayType(t))return {type:'array',items:schema(checker.getTypeArguments(t)[0]),maxItems:1000};
  const index=checker.getIndexTypeOfType(t,ts.IndexKind.String);
  if(index)return {type:'object',additionalProperties:schema(index),maxProperties:100};
  const properties={};const required=[];
  for(const prop of checker.getPropertiesOfType(t)){
    properties[prop.name]=schema(checker.getTypeOfSymbolAtLocation(prop,prop.valueDeclaration??prop.declarations[0]));
    if(!(prop.flags&ts.SymbolFlags.Optional))required.push(prop.name);
  }
  if(!Object.keys(properties).length)throw new Error('Unsupported contract type: '+checker.typeToString(t));
  return {type:'object',properties,required,additionalProperties:false};
}
const exports=['CanvasPatch','StandaloneScenePatch','AssetCreateInput','DataSourceCreateInput','AssetDataBindingCreateInput'];
for(const name of exports)schema(aliases.get(name));
// Bind component kinds to their own props; a union alone would accept wrong component properties.
const groups={
 ChartProps:['line-chart','bar-chart','area-chart','pie-chart','donut-chart','radar-chart'],ShapeProps:['rectangle','circle'],
 DecorationProps:['screen-title','background-decoration','datetime','section-title','card-background','icon-background','radar-sweep','data-stream','circuit-pulse','energy-core','industrial-flow','scan-grid'],
 PanelFrameProps:['panel-frame'],MetricCardProps:['metric-card'],RadialGaugeProps:['radial-gauge'],ProgressListProps:['progress-list'],StatusGridProps:['status-grid'],RankingListProps:['ranking-list'],AlarmListProps:['alarm-list'],DataTableProps:['data-table'],EventTimelineProps:['event-timeline'],PlainTextProps:['plain-text'],TextLinkProps:['text-link'],ImageProps:['image'],CarouselProps:['carousel'],ButtonProps:['button'],FullscreenToggleProps:['fullscreen-toggle'],SwitchProps:['switch'],CheckboxGroupProps:['checkbox-group'],RadioGroupProps:['radio-group'],SelectProps:['select'],Model3DProps:['model-3d'],Scene3DProps:['scene-3d'],AssetDetailProps:['asset-detail'],CardTitleProps:['card-title'],VectorIconProps:['vector-icon']
};
// Validate props only against the declared kind. Validating the entire props union as well
// produces unrelated errors from every other component when the selected schema fails.
const kinds=checker.getTypeFromTypeNode(aliases.get('CanvasNodeType').aliasSymbol.declarations[0].type);
assert.deepEqual(Object.values(groups).flat().sort(),kinds.types.map(t=>t.value).sort(),'Every canvas kind must have exactly one props validator');
definitions.CanvasNode.properties.props={type:'object'};
definitions.CanvasNode.allOf=Object.entries(groups).map(([name,types])=>({if:{required:['type'],properties:{type:{enum:types}}},then:{properties:{props:schema(aliases.get(name))}}}));
const output=join(root,'apps/backend/src/main/resources/contracts');mkdirSync(output,{recursive:true});
const fingerprints=Object.fromEntries(program.getSourceFiles().filter(s=>s.fileName.startsWith(root)&&!s.fileName.includes('node_modules')).map(s=>[s.fileName.slice(root.length),createHash('sha256').update(s.text).digest('hex')]));
function write(name,value){const contents=JSON.stringify(value,null,2)+'\n';const path=join(output,name);if(process.argv.includes('--check')){if(readFileSync(path,'utf8')!==contents)throw new Error('Contract drift: '+name+'; run pnpm backend:contracts');}else writeFileSync(path,contents);}
const temp=mkdtempSync(join(tmpdir(),'twin-contracts-'));
try{
 execFileSync(process.execPath,[require.resolve('typescript/bin/tsc'),'--target','ES2022','--module','commonjs','--moduleResolution','node','--strict','--skipLibCheck','--rootDir',root,'--outDir',temp,join(root,'shared/builtin-models.ts'),join(root,'shared/standalone-3d.ts'),join(root,'apps/api/src/canvas.ts'),join(root,'apps/api/src/standalone-scenes.ts')],{stdio:'inherit'});
 // Derive only documented missing-field migrations from the existing TS validator.
 // Do not make all required fields optional or default invalid/null values.
 const {validateCanvasPatch}=require(join(temp,'apps/api/src/canvas.js'));
 const legacyProps={backgroundColor:'#071525',autoRotate:false,rotationSpeed:.35,showGrid:true};
 const legacyNode={id:'legacy-model',type:'model-3d',x:0,y:0,width:600,height:400,zIndex:0,props:legacyProps,resourceRefs:[],dataBindingRefs:[]};
 const normalized=validateCanvasPatch({expectedRevision:0,upsertNodes:[legacyNode],deleteNodeIds:[]}).upsertNodes[0].props;
 for(const [key,value] of Object.entries(normalized))if(!(key in legacyProps))definitions.Model3DProps.properties[key].default=value;
 const {validateStandaloneScenePatch}=require(join(temp,'apps/api/src/standalone-scenes.js'));
 const {TWIN_ACTION_LIMITS,TWIN_ACTION_ID_PATTERN,TWIN_ACTION_ASSET_ID_PATTERN,TWIN_ACTION_TEXT_PATTERN}=require(join(temp,'shared/twin-actions.js'));
 // The shared parser's declarative limits also constrain Java's generated schema.
 const constrain=(entry,limits)=>{if(entry.anyOf)entry.anyOf.forEach(value=>constrain(value,limits));else Object.assign(entry,limits);};
 constrain(definitions.CanvasNodeInteraction.properties.clickActions,{maxItems:TWIN_ACTION_LIMITS.maximumActions});
 constrain(definitions.StandaloneSceneInstance.properties.clickActions,{maxItems:TWIN_ACTION_LIMITS.maximumActions});
 for(const [name,fields] of Object.entries({TwinMessageAction:{title:{minLength:0,maxLength:TWIN_ACTION_LIMITS.maximumTitleLength,pattern:TWIN_ACTION_TEXT_PATTERN},text:{minLength:1,maxLength:TWIN_ACTION_LIMITS.maximumTextLength,pattern:TWIN_ACTION_TEXT_PATTERN}},TwinSelectAssetAction:{assetId:{pattern:TWIN_ACTION_ASSET_ID_PATTERN}},TwinPanelAction:{nodeId:{pattern:TWIN_ACTION_ID_PATTERN}},TwinFocusModelAction:{projectId:{pattern:TWIN_ACTION_ID_PATTERN},instanceId:{pattern:TWIN_ACTION_ID_PATTERN}},TwinSetTextAction:{nodeId:{pattern:TWIN_ACTION_ID_PATTERN},text:{minLength:0,maxLength:TWIN_ACTION_LIMITS.maximumTextLength,pattern:TWIN_ACTION_TEXT_PATTERN}}}))for(const [field,limits] of Object.entries(fields))constrain(definitions[name].properties[field],limits);
 const legacySettings=Object.fromEntries(Object.keys(definitions.StandaloneSceneSettings.properties).filter(key=>key!=='preventBottomView').map(key=>[key,normalized[key]]));
 const normalizedSettings=validateStandaloneScenePatch({expectedRevision:0,settings:legacySettings}).settings;
 for(const [key,value] of Object.entries(normalizedSettings))if(!(key in legacySettings))definitions.StandaloneSceneSettings.properties[key].default=value;
 write('configuration.schema.json',{$schema:'http://json-schema.org/draft-07/schema#',definitions});write('sources.json',fingerprints);
 const builtins=createRequire(import.meta.url)(join(temp,'shared/builtin-models.js')).builtinModels;
 write('builtin-models.json',builtins);
 const source=readFileSync(join(root,'apps/api/src/canvas.ts'),'utf8');
 const minSizes=Object.fromEntries([...source.slice(source.indexOf('const minimumNodeSizes'),source.indexOf('const invalid')).matchAll(/(?:"([\w-]+)"|(\w+)):\s*\{ width: (\d+), height: (\d+) \}/g)].map(m=>[m[1]??m[2],[Number(m[3]),Number(m[4])]]));
 minSizes['card-title']=[120,32];minSizes['vector-icon']=[24,24];write('canvas-minimum-sizes.json',minSizes);
 write('scene-limits.json',createRequire(import.meta.url)(join(temp,'shared/standalone-3d.js')).STANDALONE_3D_LIMITS);
}finally{rmSync(temp,{recursive:true,force:true});}
console.log('Backend contracts '+(process.argv.includes('--check')?'verified':'generated')+'.');
