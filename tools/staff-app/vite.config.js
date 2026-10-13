import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const require = createRequire(import.meta.url);
const {scopeCss} = require('../engineering/scope-css.cjs');
const root = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  base:'/calisan/uygulama/',
  plugins:[react(),{
    name:'company-css-isolation',
    generateBundle(_,bundle) {
      for(const asset of Object.values(bundle)) if(asset.type==='asset' && asset.fileName.endsWith('.css')) {
        asset.source = scopeCss(String(asset.source)).replaceAll('#vg-tool-workspace','#vg-company-workspace')
          .replace(/:where\(#vg-company-workspace\)\s+(#vg-company-workspace)/g,'$1');
      }
    }
  }],
  build:{outDir:path.join(root,'dist'),emptyOutDir:true,manifest:true,sourcemap:false,chunkSizeWarningLimit:1800},
});
