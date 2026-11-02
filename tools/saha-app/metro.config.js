const {getDefaultConfig}=require('expo/metro-config'); const path=require('path');
const config=getDefaultConfig(__dirname);
// Shared module entry policy is the same reviewed catalogue used by the host.
config.watchFolders=[...new Set([...(config.watchFolders||[]),path.resolve(__dirname,'..')])];
config.resolver.assetExts=[...new Set([...config.resolver.assetExts,'woff2','woff'])];
const aliases={
 '@react-native-async-storage/async-storage':'src/portal/privateStorage.ts',
 'react-native-maps':'src/portal/ClosedMap.tsx',
 'expo-notifications':'src/shims/expo-notifications.web.js',
 'expo-print':'src/shims/expo-print.web.js',
 'expo-sharing':'src/shims/expo-sharing.web.js',
 'expo-image-manipulator':'src/shims/expo-image-manipulator.web.js',
};
const original=config.resolver.resolveRequest;
config.resolver.resolveRequest=(context,name,platform)=>{
 if(platform==='web'&&/[/\\]react-native-web[/\\].*[/\\]Modal[/\\]index\.js$/.test(context.originModulePath||'')) {
  const modal={ './ModalPortal':'src/portal/NativeModalPortal.tsx','./ModalFocusTrap':'src/portal/NativeModalFocusTrap.tsx' }[name];
  if(modal)return {filePath:path.resolve(__dirname,modal),type:'sourceFile'};
 }
 if(platform==='web'&&aliases[name])return {filePath:path.resolve(__dirname,aliases[name]),type:'sourceFile'};
 if(name==='@supabase/supabase-js')throw new Error('Remote SDK is not permitted in the employee app.');
 return original?original(context,name,platform):context.resolveRequest(context,name,platform);
}; module.exports=config;
