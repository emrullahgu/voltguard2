import React,{useEffect,useState} from 'react';
import {View,Text,Pressable,StyleSheet} from 'react-native';
import {SafeAreaFrameContext,SafeAreaInsetsContext} from 'react-native-safe-area-context';
import {AppProvider,useAppContext} from './src/context/AppContext';
import {AuthProvider,useAuth} from './src/context/AuthContext';
import {VisitProvider} from './src/context/VisitContext';
import ModuleNavigator from './src/navigation';
import ErrorBoundary from './src/components/ErrorBoundary';
import {emitModuleEvent,subscribeModuleEvents} from './src/portal/moduleHostBridge';
import {installWebAlertShim} from './src/utils/webAlertShim';
import {colors} from './src/theme';
import {useModuleDimensions} from './src/portal/moduleDimensions';
installWebAlertShim();
type ModuleProps={initialRoute?:string;initialParams?:any};
export function Workspace(props:ModuleProps){
  const {loading,user}=useAuth();const [notice,setNotice]=useState('');
  const {syncState,hasCanonicalData,refresh}=useAppContext();
  useEffect(()=>subscribeModuleEvents(event=>{if(event.type==='vg:saha-notice')setNotice(event.message||'İşlem tamamlanamadı.');}),[]);
  useEffect(()=>{if(!loading&&!user)emitModuleEvent('vg:saha-error',{message:'Çalışan oturumu doğrulanamadı.'});},[loading,user]);
  useEffect(()=>{if(!loading&&user&&!hasCanonicalData&&(syncState==='error'||syncState==='offline'))emitModuleEvent('vg:saha-error',{message:'Şirket kayıtları yüklenemedi. Bağlantınızı kontrol edip yeniden deneyin.'});},[loading,user,hasCanonicalData,syncState]);
  if(loading)return <View style={styles.loading}><Text>Çalışan oturumu doğrulanıyor…</Text></View>;
  if(!user)return <View style={styles.loading}><Text accessibilityRole="alert">Çalışan oturumu doğrulanamadı.</Text></View>;
  if(!hasCanonicalData){
    if(syncState==='error'||syncState==='offline')return <View style={styles.loading}><Text accessibilityRole="alert">Şirket kayıtları yüklenemedi. Bağlantınızı kontrol edip yeniden deneyin.</Text><Pressable accessibilityRole="button" onPress={()=>{void refresh();}}><Text>Yeniden dene</Text></Pressable></View>;
    return <View style={styles.loading}><Text>Şirket kayıtları yükleniyor…</Text></View>;
  }
  return <View style={styles.root}>{notice?<View accessibilityRole="alert" style={styles.notice}><Text style={styles.noticeText}>{notice}</Text><Pressable accessibilityRole="button" accessibilityLabel="Uyarıyı kapat" onPress={()=>setNotice('')}><Text style={styles.noticeText}>Kapat</Text></Pressable></View>:null}<ModuleNavigator {...props}/></View>;
}
const moduleInsets={top:0,right:0,bottom:0,left:0};
export default function EmployeeModuleApp(props:ModuleProps){const size=useModuleDimensions();return <SafeAreaInsetsContext.Provider value={moduleInsets}><SafeAreaFrameContext.Provider value={{x:0,y:0,width:size.width,height:size.height}}><ErrorBoundary><AuthProvider><VisitProvider><AppProvider><Workspace {...props}/></AppProvider></VisitProvider></AuthProvider></ErrorBoundary></SafeAreaFrameContext.Provider></SafeAreaInsetsContext.Provider>}
const styles=StyleSheet.create({root:{flex:1,minHeight:0,backgroundColor:colors.bg.primary},loading:{flex:1,padding:24,gap:16,backgroundColor:colors.bg.primary},notice:{backgroundColor:'#fff4dc',borderBottomWidth:1,borderColor:'#b45309',padding:12,gap:8,flexDirection:'row',justifyContent:'space-between'},noticeText:{color:'#744b10',fontFamily:'Inter',fontSize:14,lineHeight:21}});
