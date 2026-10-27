import {registerRootComponent} from 'expo';
import React,{useEffect,useState} from 'react';
import {View,Text,Pressable} from 'react-native';
import * as Font from 'expo-font';
import {bootstrapPortal,postParent,reportPortalError} from './src/portal/api';
import {installNetworkPolicy} from './src/portal/networkPolicy';
import './portal.css';
installNetworkPolicy();
globalThis.__SAHATAKIP_THEME__='light';
function Root(){
 const [Component,setComponent]=useState(null); const [error,setError]=useState('');
 useEffect(()=>{let active=true;(async()=>{
   const bootstrap=await bootstrapPortal();
   const stored=bootstrap.cache?.['sahatakip.themeMode'];
   globalThis.__SAHATAKIP_THEME__=stored==='dark'?'dark':stored==='system'&&window.matchMedia?.('(prefers-color-scheme: dark)').matches?'dark':'light';
   await Font.loadAsync({Inter:require('./assets/fonts/inter-latin-ext.f863e429.woff2'),Outfit:require('./assets/fonts/outfit-latin-ext.66bfbedb.woff2')});
   const App=require('./App').default; if(active)setComponent(()=>App);
 })().catch(e=>{reportPortalError(e);postParent('vg:saha-error',{message:e?.message||'Uygulama başlatılamadı.'});if(active)setError(e?.message||'Uygulama başlatılamadı.');});return()=>{active=false};},[]);
 if(Component)return React.createElement(Component);
 return React.createElement(View,{style:{flex:1,padding:32,gap:16,backgroundColor:'#f5f7fa'}},React.createElement(Text,{accessibilityRole:error?'alert':'text',style:{fontSize:18,color:'#12243a'}},error||'Saha çalışma alanı açılıyor…'),error?React.createElement(Pressable,{onPress:()=>window.location.reload()},React.createElement(Text,null,'Yeniden dene')):null);
}
registerRootComponent(Root);
