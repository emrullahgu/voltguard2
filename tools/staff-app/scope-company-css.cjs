'use strict';
const {scopeCss}=require('../engineering/scope-css.cjs');
function scopeCompanyCss(css) {
  return scopeCss(css).replaceAll('#vg-tool-workspace','#vg-company-workspace')
    .replace(/:where\(#vg-company-workspace\)\s+(#vg-company-workspace)/g,'$1')
    // These selectors already name the private workspace. Its theme condition
    // belongs to the real document, not to a second impossible workspace.
    .replace(/#vg-company-workspace(\[data-theme(?:=[^\]]+)?\])\s+#vg-company-workspace/g,'html$1 #vg-company-workspace');
}
module.exports={scopeCompanyCss};
