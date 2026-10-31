'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ts=require('../saha-app/node_modules/typescript');
const root=path.resolve(__dirname,'../saha-app');

function fixture(hosted=true,nested=false){
 const NativeText=function NativeText(){},NativeInput=function NativeInput(){};
 const react={createContext:()=>({Provider:'TextParent'}),useContext:()=>nested,forwardRef:render=>render,createElement:(type,props,...children)=>({type,props:{...props,children}})};
 const filename=path.join(root,'src/portal/SiteTypography.tsx');
 const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{fileName:filename,compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
 const module={exports:{}};
 vm.runInNewContext(code,{module,exports:module.exports,window:hosted?{VoltGuardEmployeeModules:{}}:{},require:name=>name==='react'?react:{Text:NativeText,TextInput:NativeInput,StyleSheet:{flatten:style=>style}}});
 return {...module.exports,NativeText,NativeInput};
}

test('Site text supplies Inter while preserving explicit headings, refs and nested text size',()=>{
 const f=fixture(),ref={},heading={fontFamily:'Outfit',fontSize:24};
 const view=f.SiteText({style:heading,children:'A heading'},ref).props.children[0];
 assert.equal(view.type,f.NativeText);assert.equal(view.props.ref,ref);
 assert.match(view.props.style[0].fontFamily,/^Inter,/);assert.equal(view.props.style[1],heading);
 assert.match(view.props.style[2].fontFamily,/^Outfit,.*sans-serif/);
 const nested=fixture(true,true).SiteText({children:'inline suffix'},ref).props.children[0];
 assert.equal(nested.props.style[0],false,'Nested text must inherit the parent heading size');
 const original=fixture(false);const plain=original.SiteText({style:heading},ref);
 assert.equal(plain.props.style,heading,'Non-hosted source keeps its original typography');
 const input=f.SiteTextInput({style:{fontSize:16}},ref);
 assert.match(input.props.style[0].fontFamily,/^Inter,/);assert.equal(input.props.style[1].fontSize,16);
});

test('Build rewrites only app Text imports; icon libraries and the adapter retain native Text',()=>{
 const babel=require('../staff-app/node_modules/@babel/core');
 const plugin=require('../saha-app/src/portal/scopedNetworkPlugin.cjs');
 const compile=(filename)=>babel.transformSync('import {Text, TextInput as Input, View} from "react-native"; const label = Text;', {filename,configFile:false,babelrc:false,plugins:[plugin]}).code;
 const own=compile(path.join(root,'src/screens/SyntheticScreen.js'));
 assert.match(own,/SiteText as Text/);assert.match(own,/SiteTextInput as Input/);
 assert.match(own,/SiteTypography/);
 const icon=compile(path.join(root,'node_modules/icon-library/index.js'));
 assert.doesNotMatch(icon,/SiteTypography/);
 const adapter=compile(path.join(root,'src/portal/SiteTypography.tsx'));
 assert.doesNotMatch(adapter,/SiteText as Text/,'Adapter cannot import itself recursively');
});

test('Runtime font families load the site subsets with Latin and Turkish glyphs',()=>{
 const crypto=require('node:crypto');
 const source=fs.readFileSync(path.join(root,'index.js'),'utf8');
 for(const [family,file] of [['Inter','inter-latin.d14332d6.woff2'],['Outfit','outfit-latin.dbb71e00.woff2']]){
  assert.ok(source.includes(`${family}:require('./assets/fonts/${file}')`));
  const hash=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');
  assert.equal(hash(fs.readFileSync(path.join(root,'assets/fonts',file))),hash(fs.readFileSync(path.resolve(root,'../../fonts',file))));
 }
 assert.doesNotMatch(source,/Inter:require\('[^']*latin-ext/);
});
