import React,{useEffect,useState} from 'react';
import {View,Text,Pressable,StyleSheet} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {AppProvider,useAppContext} from './src/context/AppContext';
import {AuthProvider,useAuth} from './src/context/AuthContext';
import {VisitProvider} from './src/context/VisitContext';
import AppNavigator from './src/navigation';
import ErrorBoundary from './src/components/ErrorBoundary';
import {postParent,bootstrapPortal} from './src/portal/api';
import {installWebAlertShim} from './src/utils/webAlertShim';
installWebAlertShim();
function Workspace(){
  const {loading,user}=useAuth(); const {syncState}=useAppContext(); const [notice,setNotice]=useState('');
  useEffect(()=>{ const listener=(event:any)=>setNotice(event.detail||'İşlem tamamlanamadı.'); window.addEventListener('vg:saha-notice',listener); return()=>window.removeEventListener('vg:saha-notice',listener);},[]);
  useEffect(()=>{if(!loading&&user&&syncState==='idle')postParent('vg:saha-ready');},[loading,user,syncState]);
  if(loading)return <View style={styles.loading}><Text>Çalışan oturumu doğrulanıyor…</Text></View>;
  if(!user)return <View style={styles.loading}><Text accessibilityRole="alert">Çalışan oturumu doğrulanamadı.</Text><Pressable onPress={()=>window.location.reload()}><Text>Yeniden dene</Text></Pressable></View>;
  return <View style={styles.root}>{notice?<View accessibilityRole="alert" style={styles.notice}><Text style={styles.noticeText}>{notice}</Text><Pressable accessibilityRole="button" accessibilityLabel="Uyarıyı kapat" onPress={()=>setNotice('')}><Text style={styles.noticeText}>Kapat</Text></Pressable></View>:null}<AppNavigator/></View>;
}
export default function App(){return <SafeAreaProvider><ErrorBoundary><AuthProvider><VisitProvider><AppProvider><Workspace/></AppProvider></VisitProvider></AuthProvider></ErrorBoundary></SafeAreaProvider>}
const styles=StyleSheet.create({root:{flex:1,minHeight:0,backgroundColor:'#f5f7fa'},loading:{flex:1,padding:32,gap:16,backgroundColor:'#f5f7fa'},notice:{backgroundColor:'#fff4dc',borderBottomWidth:1,borderColor:'#d99b36',padding:12,gap:8,flexDirection:'row',justifyContent:'space-between'},noticeText:{color:'#744b10',fontFamily:'Inter',fontSize:14,lineHeight:21}});
