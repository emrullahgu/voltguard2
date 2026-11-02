'use strict';
// Static candidates explain coverage limits; they never count as rendered UI.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
let ts;try{ts=require('../saha-app/node_modules/typescript');}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;ts=require('typescript');}
module.exports=function analyze(){
 const source=require('./employee-screen-inventory.cjs')(),known=new Set(source.routes.map(r=>r.route));
 const edges=[];
 for(const route of source.routes){
  if(!route.source)continue;
  const code=fs.readFileSync(path.join(root,route.source),'utf8'),file=ts.createSourceFile(route.source,code,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  function add(node,value,kind){const target=source.normalize(value);if(known.has(target))edges.push({from:route.route,to:target,source:route.source,line:file.getLineAndCharacterOfPosition(node.getStart(file)).line+1,kind});}
  function walk(node){
   if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&['navigate','push','replace'].includes(node.expression.name.text)&&node.arguments[0]&&ts.isStringLiteral(node.arguments[0]))add(node,node.arguments[0].text,'literal-navigation');
   if(ts.isJsxAttribute(node)&&['route','screen'].includes(node.name.getText(file))&&node.initializer&&ts.isStringLiteral(node.initializer))add(node,node.initializer.text,'component-route');
   if(ts.isPropertyAssignment(node)&&['route','nav','key','k','screen','target'].includes(node.name.getText(file).replace(/['"]/g,''))&&ts.isStringLiteral(node.initializer))add(node,node.initializer.text,'data-navigation-candidate');
   ts.forEachChild(node,walk);
  }
  walk(file);
 }
 const unique=[...new Map(edges.map(e=>[e.from+'>'+e.to+'@'+e.line,e])).values()];
 const paths=entries=>{
  const found=new Map(entries.map(e=>[e.route,[]])),queue=entries.map(e=>e.route);
  while(queue.length){const from=queue.shift();for(const edge of unique.filter(e=>e.from===from))if(!found.has(edge.to)){found.set(edge.to,[...found.get(from),edge]);queue.push(edge.to);}}
  return found;
 };
 const enabled=paths(source.entries.filter(e=>e.enabled)),all=paths(source.entries);
 const closed={ErpConnectionForm:'ErpConnections',IntegrationWebhookForm:'IntegrationWebhooks',IntegrationWebhookDeliveries:'IntegrationWebhooks',ExtConfig:'ExtHub',ExtLogs:'ExtHub'};
 const routes=source.routes.map(({route,source:screenSource})=>({
  route,source:screenSource,directEntry:source.entries.find(e=>e.route===route)||null,
  enabledStaticPath:enabled.get(route)??null,allCatalogueStaticPath:all.get(route)??null,
  incoming:unique.filter(e=>e.to===route),
  boundary:closed[route]?{kind:'closed-parent-service',parent:closed[route],evidence:'Parent renders an unavailable error before list/add controls; verified by actual compiled browser retry.'}:route==='OrdDetail'?{kind:'unimplemented-order-store',source:'tools/saha-app/src/services/orders.ts',evidence:'listOrders returns []; getOrder returns undefined. No real order record can be selected.'}:!enabled.has(route)&&all.has(route)?{kind:'disabled-catalogue-capability',capability:'externalAI',evidence:'Only static catalogue paths originate from disabled AI entries; actual menu/native gate both deny these entries.'}:!enabled.has(route)?{kind:'no-resolved-static-path',evidence:'No path resolved from an enabled catalogue entry in registered screen sources. Not proof of a dead route.'}:null,
 }));
 return {generatedAt:new Date().toISOString(),scope:'Current flat employee portal registered screen sources and catalogue',limitations:['Static edges are candidate paths, not evidence that a control rendered or a route opened.','Dynamic navigation expressions and data/state-dependent controls can require additional runtime evidence.','No disabled capability, device requirement or unavailable backing service was bypassed.'],registeredRoutes:routes.length,edges:unique,routes};
};
if(require.main===module){const result=module.exports(),output=path.join(root,'.qa/employee-route-boundaries.json');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(result,null,2));console.log(JSON.stringify({output,registeredRoutes:result.registeredRoutes,boundaries:result.routes.reduce((sum,r)=>{if(r.boundary)sum[r.boundary.kind]=(sum[r.boundary.kind]||0)+1;return sum;},{})}));}
