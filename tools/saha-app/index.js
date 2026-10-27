import 'expo';
import React from 'react';
import {AppRegistry} from 'react-native';
import * as Font from 'expo-font';
import {bootstrapPortal,clearPortalMemory,getPendingWrites,getWriteStatus,clearWriteFailure,postParent} from './src/portal/api';
import {connectModuleHost,subscribeModuleEvents} from './src/portal/moduleHostBridge';
import {assertModuleEntry} from './src/portal/moduleEntryGate';
import './portal.css';

const KEY='VoltGuardEmployeeModule';
let LoadedApp=null;
let active=null;
let mounting=null;
let generation=0;
let fonts=null;
AppRegistry.registerComponent(KEY,()=>function EmployeeModuleRoot(props){return React.createElement(LoadedApp,props);});
function parentTheme(value){
  const theme=value||document.documentElement.dataset.theme;
  return theme==='dark'?'dark':'light';
}
async function loadStyles(shadow,urls=[]){
  await Promise.all([...new Set(urls)].map(raw=>new Promise((resolve,reject)=>{
    const url=new URL(raw,window.location.origin);
    if(url.origin!==window.location.origin||!url.pathname.startsWith('/calisan/uygulama/assets/saha/')||!url.pathname.endsWith('.css')){reject(new Error('Modül stil kaynağı doğrulanamadı.'));return;}
    const existing=[...shadow.querySelectorAll('link[data-employee-module-style]')].find(node=>node.href===url.href);
    if(existing?.sheet){resolve();return;}
    const link=existing||document.createElement('link');
    link.rel='stylesheet';link.href=url.href;link.dataset.employeeModuleStyle='true';
    const done=()=>{clearTimeout(timer);resolve();};
    const fail=()=>{clearTimeout(timer);link.remove();reject(new Error('Modül stilleri yüklenemedi.'));};
    const timer=setTimeout(fail,30000);
    link.addEventListener('load',done,{once:true});link.addEventListener('error',fail,{once:true});
    if(!existing)shadow.appendChild(link);
  })));
}
async function mount(host,options={}){
  const request=++generation;
  if(!host||host.nodeType!==1||typeof host.attachShadow!=='function')throw new Error('Modül alanı bulunamadı.');
  if(mounting)await mounting.catch(()=>{});
  if(request!==generation)throw new Error('Modül yükleme isteği değişti.');
  if(active){
    if(!active.controller.unmount())throw new Error('Kayıt isteği tamamlandıktan sonra modülü yeniden açabilirsiniz.');
  }
  const prepare=(async()=>{
    const shadow=host.shadowRoot||host.attachShadow({mode:'open'});
    await loadStyles(shadow,options.styles||[]);
    const identity=await bootstrapPortal();
    globalThis.__SAHATAKIP_THEME__=parentTheme(options.theme);
    if(!fonts)fonts=Font.loadAsync({Inter:require('./assets/fonts/inter-latin-ext.f863e429.woff2'),Outfit:require('./assets/fonts/outfit-latin-ext.66bfbedb.woff2')}).catch(error=>{fonts=null;throw error;});
    await fonts;
    if(!host.isConnected||options.signal?.aborted||request!==generation)throw new Error('Modül alanı kapatıldı.');
    const navigation=require('./src/navigation');
    const route=assertModuleEntry(options.route||'WorkOrders',identity,navigation.normalizeModuleRoute);
    LoadedApp=require('./App').default;
    const node=document.createElement('div');node.dataset.vgModuleRoot='true';shadow.appendChild(node);
    const detach=connectModuleHost(node,options.onEvent);
    let disposed=false,deferred=false,reactRoot;
    const destroy=()=>{
      if(disposed)return true;
      if(getPendingWrites()>0){deferred=true;return false;}
      disposed=true;unsubscribe();reactRoot?.unmount();node.remove();detach();
      if(active?.host===host)active=null;
      clearPortalMemory();return true;
    };
    const unsubscribe=subscribeModuleEvents(event=>{if(deferred&&event.type==='vg:saha-storage'&&event.pending===0)queueMicrotask(destroy);});
    const controller={
      setRoute(name,params){if(disposed)throw new Error('Modül alanı kapalı.');navigation.setModuleRoute(assertModuleEntry(name,identity,navigation.normalizeModuleRoute),params);},
      navigate(name,params){this.setRoute(name,params);},
      goBack(){if(!disposed)navigation.goBackInModule();},
      canGoBack(){return !disposed&&navigation.navigationRef.isReady()&&navigation.navigationRef.canGoBack();},
      getWriteStatus,clearWriteFailure,
      unmount:destroy,
    };
    try{
      reactRoot=AppRegistry.runApplication(KEY,{rootTag:node,initialProps:{initialRoute:route,initialParams:options.params},mode:'concurrent'});
      if(!reactRoot||typeof reactRoot.unmount!=='function')throw new Error('Modül görüntüleyicisi başlatılamadı.');
      active={host,controller};
      postParent('vg:saha-storage',getWriteStatus());
      return controller;
    }catch(error){destroy();throw error;}
  })();
  mounting=prepare;
  try{return await prepare;}
  catch(error){options.onEvent?.({type:'vg:saha-error',message:error?.message||'Modül açılamadı.'});throw error;}
  finally{if(mounting===prepare)mounting=null;}
}
if(typeof window!=='undefined')window.VoltGuardEmployeeModules=Object.freeze({version:1,mount});
