throw new Error('Bu tek seferlik içe aktarma betiği kullanımdan kaldırıldı; incelenmiş portal kaynaklarını yeniden yazmayın. Mevcut kaynaklar için build-saha.cjs kullanın.');
/* Auditable hardening of the reviewed copy, after dependency installation. */
const fs=require('fs'),path=require('path'),ts=require('typescript');
const root=__dirname;
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);}
const records=[];
const external=new Set(['ai.ts','aiAssistant.ts','aiRouter.ts','aiCopilot.ts','aiKnowledgeBase.ts','aiChatSessions.ts','apollo.ts','parasut.ts','integrations.ts','enterpriseIntegrations.ts','extensions.ts','advanced.ts','osos.ts']);
for(const file of walk(path.join(root,'src')).filter(f=>/\.(tsx?|js)$/.test(f))){
 let text=fs.readFileSync(file,'utf8'); const relative=path.relative(root,file).replaceAll('\\','/'); const edits=[];
 const ast=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,file.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 const service=relative.startsWith('src/services/');
 const visit=node=>{
  if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&/^(seed|SEED|DEMO|MOCK|FAKE)/.test(node.name.text)&&node.initializer&&ts.isArrayLiteralExpression(node.initializer)&&node.initializer.elements.length){edits.push({start:node.initializer.getStart(ast),end:node.initializer.end,value:'[]'});}
  if(service&&ts.isFunctionDeclaration(node)&&node.body){
   const exported=node.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword);
   const asynchronous=node.modifiers?.some(m=>m.kind===ts.SyntaxKind.AsyncKeyword);
   const source=node.body.getText(ast);
   const simulated=exported&&/Math\.random\(|(?:simulat|mock|fake).*(?:success|passed)/i.test(source)&&!/\b(uid|uuid|generateId|randomId)\b/i.test(node.name?.text||'');
   if(exported&&asynchronous&&(external.has(path.basename(file))||simulated)){
    edits.push({start:node.body.getStart(ast),end:node.body.end,value:'{ throw reportPortalError(new Error("Bu dış hizmet Ubuntu sunucusunda yapılandırılmadı. İşlem gerçekleştirilmedi.")); }'}); return;
   }
   if(/^seed/.test(node.name?.text||'')){
    const findReturn=n=>{if(ts.isReturnStatement(n)&&n.expression&&ts.isArrayLiteralExpression(n.expression)&&n.expression.elements.some(ts.isObjectLiteralExpression))edits.push({start:n.expression.getStart(ast),end:n.expression.end,value:'[]'});else ts.forEachChild(n,findReturn);}; findReturn(node.body);
   }
  }
  ts.forEachChild(node,visit);
 };visit(ast);
 if(edits.length){edits.sort((a,b)=>b.start-a.start);for(const edit of edits)text=text.slice(0,edit.start)+edit.value+text.slice(edit.end);
  if(text.includes('throw reportPortalError')&&!text.includes("from '../portal/api'")&&!relative.startsWith('src/portal/')){
   let rel=path.relative(path.dirname(file),path.join(root,'src/portal/api')).replaceAll('\\','/');if(!rel.startsWith('.'))rel='./'+rel;text=`import {reportPortalError} from '${rel}';\n`+text;
  }
  records.push({file:relative,edits:edits.length});
 }
 text=text.replaceAll('/functions/v1/','/api/unconfigured-functions/').replaceAll('/auth/v1/','/api/unconfigured-auth/').replaceAll('/rest/v1/','/api/unconfigured-data/');
 if(relative==='src/theme.ts')text=text.replace(/    if \(typeof localStorage[^]*?\n    }\r?\n/,'');
 fs.writeFileSync(file,text);
}
for(const name of ['quotesRepo.ts','customersRepo.ts','workOrdersRepo.ts','employeesRepo.ts']){
 const file=path.join(root,'src/services/data',name);let text=fs.readFileSync(file,'utf8');
 text=text.replace(/if \(error\) \{\s*console\.warn\([^]*?return \(await cacheGet<[^]*?\?\? \[\];\s*\}/g,'if (error) throw error;');
 text=text.replace(/if \(!isUuid\(id\)\) \{[^]*?\n    }/g,'if (!isUuid(id)) throw new Error("Geçersiz kayıt kimliği. Sunucuya kayıt yapılamadı.");');
 fs.writeFileSync(file,text);
}
fs.writeFileSync(path.join(root,'review-transform.json'),JSON.stringify({date:'2026-10-27',notes:['No original source changed','Private source catalogs excluded','Seed object arrays removed','Unconfigured external services fail closed','No offline commits'],records},null,2)+'\n');
console.log(JSON.stringify({hardenedFiles:records.length,edits:records.reduce((n,r)=>n+r.edits,0)}));
