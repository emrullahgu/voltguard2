throw new Error('Bu tek seferlik içe aktarma betiği kullanımdan kaldırıldı; incelenmiş portal kaynaklarını yeniden yazmayın. Mevcut kaynaklar için build-saha.cjs kullanın.');
/* One-time review transform, scoped to this private copy. Never modifies the source app. */
const fs = require('fs'); const path = require('path');
const root = __dirname; const original = path.resolve(root, '../../SahaTakip-main');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const write = (p, text) => { const dest = path.join(root,p); fs.mkdirSync(path.dirname(dest),{recursive:true}); fs.writeFileSync(dest,text); };
const sourcePackage = JSON.parse(fs.readFileSync(path.join(original,'package.json'),'utf8'));
const sourceLock = JSON.parse(fs.readFileSync(path.join(original,'package-lock.json'),'utf8'));
const pkg = { name:'voltguard-employee-saha', version:'1.0.0', private:true, main:'index.js', scripts:{'build:web':'expo export --platform web --output-dir dist','typecheck':'tsc --noEmit'}, dependencies:{}, devDependencies:{} };
for(const section of ['dependencies','devDependencies']) for(const [name] of Object.entries(sourcePackage[section]||{})) {
  if(['@supabase/supabase-js','supabase','patch-package','@react-native-async-storage/async-storage'].includes(name)) continue;
  const version=sourceLock.packages?.['node_modules/'+name]?.version;
  if(!version) throw new Error('Locked dependency missing: '+name);
  pkg[section][name]=version;
}
write('package.json',JSON.stringify(pkg,null,2)+'\n');
write('app.json',JSON.stringify({expo:{name:'VoltGuard Saha',slug:'voltguard-employee-saha',version:'1.0.0',web:{bundler:'metro',output:'single',favicon:'./assets/favicon.png'},experiments:{baseUrl:'/calisan/uygulama/assets/saha'}}},null,2)+'\n');
write('src/services/supabase.ts',"export * from '../portal/nativeClient';\n");
write('src/context/AuthContext.tsx',"export * from '../portal/NativeAuth';\n");
write('src/services/data/repository.ts',"export * from '../../portal/repository';\n");
write('src/data/initialData.ts',`/* Private source catalogs and customer/personnel seeds were intentionally excluded. */
export const SERVICE_CATALOG: any[]=[];
export const MATERIAL_CATALOG: any[]=[];
export const MATERIAL_CATEGORIES: string[]=[];
export const MATERIAL_BRANDS: string[]=[];
export const CLIENTS: any[]=[];
export const INITIAL_WORK_ORDERS: any[]=[];
export const INITIAL_EMPLOYEES: any[]=[];
`);
const poz = fs.readFileSync(path.join(original,'src/data/pozCatalog.ts'),'utf8').split('// Tek kaynak:')[0];
write('src/data/pozCatalog.ts',poz+`\nexport const POZ_CATALOG: PozItem[]=[];
export const POZ_CATEGORIES: PozCategory[]=['Malzeme','İşçilik','Servis','Mühendislik','Ulaşım','Diğer'];
export const findPoz=(id:string)=>POZ_CATALOG.find(p=>p.id===id);
export const pozByCategory=(category:PozCategory)=>POZ_CATALOG.filter(p=>p.category===category);
`);
let app = read('src/context/AppContext.tsx');
app=app.replace(/import \{ REAL_CUSTOMERS \} from '[^']+';\r?\n/g,'').replace('const INITIAL_CUSTOMERS: Customer[] = REAL_CUSTOMERS;','const INITIAL_CUSTOMERS: Customer[] = [];');
write('src/context/AppContext.tsx',app);
let theme=read('src/theme.ts');
theme=theme.replace(/    if \(typeof localStorage[^]*?\n    }\n/,'');
for(const [from,to] of Object.entries({'#1e40af':'#12243a','#3b82f6':'#274862','#1e3a8a':'#0b1726','#22c55e':'#d99b36','#4ade80':'#edbd69','#16a34a':'#ac751e','rgba(34, 197, 94':'rgba(217, 155, 54','rgba(30, 64, 175':'rgba(18, 36, 58'})) theme=theme.split(from).join(to);
theme=theme.replace(/h([1-4]): \{ fontSize:/g,'h$1: { fontFamily: \'Outfit\', fontSize:').replace(/title: \{ fontSize:/,'title: { fontFamily: \'Outfit\', fontSize:').replace(/body: \{ fontSize:/,'body: { fontFamily: \'Inter\', fontSize:').replace(/caption: \{ fontSize:/,'caption: { fontFamily: \'Inter\', fontSize:');
write('src/theme.ts',theme);
let mode=read('src/themeMode.ts');
mode=mode.replace(/  try \{\r?\n    if \(typeof localStorage[^]*?\r?\n  } catch \{[^]*?\r?\n  }\r?\n/,'');
write('src/themeMode.ts',mode);
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);}
for(const file of walk(path.join(root,'src')).filter(f=>/\.(tsx?|js)$/.test(f))) {
  let text=fs.readFileSync(file,'utf8');
  text=text.replace(/process\.env\.EXPO_PUBLIC_SUPABASE_[A-Z_]+/g,"''");
  text=text.replace(/https:\/\/[^\s'"`]*\.supabase\.co[^\s'"`]*/g,'unconfigured:server');
  text=text.replace(/api\.openai\.com/g,'unconfigured-ai.local').replace(/generativelanguage\.googleapis\.com/g,'unconfigured-ai.local');
  text=text.replace(/service_role/g,'server_secret').replace(/SUPABASE_ANON_KEY/g,'NATIVE_SERVER_ONLY').replace(/VITE_SUPABASE/g,'NATIVE_SERVER');
  text=text.replace(/\bSupabase\b/g,'Şirket sunucusu');
  fs.writeFileSync(file,text);
}
const blocked = `import React from 'react'; import {View,Text,StyleSheet,Pressable} from 'react-native';
export default function ServerConfiguration(){return <View style={styles.page}><Text style={styles.title}>Sunucu yapılandırması gerekli</Text><Text style={styles.body}>Dış hizmetler ve güvenlik anahtarları Ubuntu sunucusunda yetkili yönetici tarafından yapılandırılır. Bu ekranda anahtar tutulmaz; hizmet etkinleşmeden işlem yapılmaz.</Text><Pressable accessibilityRole="button" onPress={()=>window.top!.location.assign('/calisan/')}><Text style={styles.link}>Çalışan hesabına dön</Text></Pressable></View>};
const styles=StyleSheet.create({page:{flex:1,padding:28,backgroundColor:'#f5f7fa',gap:16},title:{fontSize:24,fontWeight:'700',fontFamily:'Outfit',color:'#12243a'},body:{fontSize:16,lineHeight:25,color:'#475569'},link:{color:'#8a5b15',fontSize:16,fontWeight:'700'}});`;
for(const name of ['ApiKeysScreen','ExternalApiKeysScreen','AiSettingsScreen']) write('src/screens/'+name+'.tsx',blocked);
for(const name of ['LoginScreen','SignupScreen','ForgotPasswordScreen','ResetPasswordScreen','ChangePasswordScreen']) write('src/screens/'+name+'.tsx',`import React,{useEffect} from 'react'; import {View,Text} from 'react-native'; export default function NativeSecurity(){useEffect(()=>{window.top!.location.replace('/calisan/');},[]);return <View><Text>Çalışan güvenlik sayfası açılıyor…</Text></View>;}`);
console.log(JSON.stringify({copiedScreens:fs.readdirSync(path.join(root,'src/screens')).filter(n=>n.endsWith('.tsx')).length,dependencyCount:Object.keys(pkg.dependencies).length}));
