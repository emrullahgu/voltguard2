'use strict';

// Source inventory only. A registered route is never counted as browser-tested.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const ts=require(path.join(root,'tools/saha-app/node_modules/typescript'));
module.exports=function inventory(){
  const source=fs.readFileSync(path.join(root,'tools/saha-app/src/navigation/index.tsx'),'utf8');
  const catalogue=JSON.parse(fs.readFileSync(path.join(root,'tools/employee-modules.json'),'utf8'));
  const aliases={MainTabs:'WorkOrders',Home:'WorkOrders',Explore:'WorkOrders',Dashboard:'KpiOverview',OfficeHub:'Office',HomeDashboard:'KpiOverview'};
  const normalize=name=>aliases[name]||name;
  const registrations=[...source.matchAll(/<Stack\.Screen[\s\S]*?\bname="([^"]+)"[\s\S]*?\bcomponent=\{(\w+)\}/g)].map(match=>({name:match[1],route:normalize(match[1]),component:match[2]}));
  const routes=[...new Map(registrations.map(route=>[route.route,route])).values()],known=new Set(routes.map(route=>route.route));
  const imports=new Map([...source.matchAll(/import (\w+) from '\.\.\/screens\/([^']+)';/g)].map(match=>[match[1],'tools/saha-app/src/screens/'+match[2]+'.tsx']));
  const types=ts.createSourceFile('types.ts',fs.readFileSync(path.join(root,'tools/saha-app/src/types/index.ts'),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  const parameters=new Map();
  for(const statement of types.statements)if(ts.isTypeAliasDeclaration(statement)&&['RootStackParamList','TabParamList'].includes(statement.name.text))for(const property of statement.type.members||[]){
    const type=property.type,optional=type.kind===ts.SyntaxKind.UndefinedKeyword||ts.isUnionTypeNode(type)&&type.types.some(item=>item.kind===ts.SyntaxKind.UndefinedKeyword);
    const object=ts.isTypeLiteralNode(type)?type:ts.isUnionTypeNode(type)?type.types.find(ts.isTypeLiteralNode):null;
    parameters.set(normalize(property.name.getText(types)),{required:!optional,fields:object?.members.filter(member=>ts.isPropertySignature(member)&&!member.questionToken).map(member=>member.name.getText(types))||[]});
  }
  const entries=catalogue.modules.flatMap(module=>module.variants.filter(variant=>variant.route).map(variant=>({module:module.id,section:variant.id,route:normalize(variant.route),enabled:!module.draftOnly&&!module.capability&&!variant.capability})));
  for(const route of routes){
    route.source=imports.get(route.component);route.parameters=parameters.get(route.route);route.catalogueEntry=entries.some(entry=>entry.route===route.route);route.cards=[];
    if(!route.source||!fs.existsSync(path.join(root,route.source)))continue;
    const file=ts.createSourceFile(route.source,fs.readFileSync(path.join(root,route.source),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    function walk(node){
      if(ts.isObjectLiteralExpression(node)){
        const properties=node.properties.filter(ts.isPropertyAssignment);
        const name=property=>property.name.getText(file).replace(/['"]/g,'');
        const target=properties.find(property=>['nav','route','screen','key','target','k'].includes(name(property))&&ts.isStringLiteral(property.initializer)&&known.has(normalize(property.initializer.text)));
        const label=properties.find(property=>['label','title','l'].includes(name(property))&&ts.isStringLiteral(property.initializer));
        if(target&&label)route.cards.push({label:label.initializer.text,route:normalize(target.initializer.text)});
      }
      ts.forEachChild(node,walk);
    }
    walk(file);
    route.cards=[...new Map(route.cards.map(card=>[card.label+'|'+card.route,card])).values()];
  }
  return {catalogue,entries,routes,registeredNames:registrations.length,normalize};
};
