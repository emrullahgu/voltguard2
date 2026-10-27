'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {scopeCompanyCss}=require('../staff-app/scope-company-css.cjs');
test('Company CSS preserves the real document theme while keeping every component inside its workspace',()=>{
 const css=scopeCompanyCss('html[data-theme=dark] #vg-company-workspace .employee-module-host{--bg:#0a1628}h1{color:red}@media print{html[data-theme=dark] #vg-company-workspace{background:white}}');
 assert.match(css,/html\[data-theme=dark\] #vg-company-workspace \.employee-module-host\{/);
 assert.match(css,/:where\(#vg-company-workspace\) h1\{/);
 assert.match(css,/@media print\{html\[data-theme=dark\] #vg-company-workspace\{/);
 assert.doesNotMatch(css,/#vg-company-workspace\[data-theme/);
});
test('All actual native theme rules survive the production scoping transform',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../staff-app/src/site-theme.css'),'utf8');
 const scoped=scopeCompanyCss(source);
 assert.doesNotMatch(scoped,/#vg-company-workspace\[data-theme=dark\]\s+#vg-company-workspace/);
 assert.match(scoped,/html\[data-theme=dark\] #vg-company-workspace \.employee-module-host\{--vg-module-bg-primary:#0a1628/);
 assert.match(scoped,/html\[data-theme=dark\] #vg-company-workspace :is\(\.employee-module-card/);
});
