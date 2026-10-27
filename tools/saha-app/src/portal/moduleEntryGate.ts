import manifest from '../../../employee-modules.json';
import type { PortalBootstrap } from './api';
type EntryRule = { roles?: string[]; adminOnly?: boolean; capability?: string };
type ModuleRule = EntryRule & { variants: (EntryRule & { route?: string })[] };
const modules = manifest.modules as ModuleRule[];
const roles: Record<string,string> = { admin:'admin',manager:'payroll',payroll:'payroll',engineer:'employee',field:'employee',employee:'employee' };
export function assertModuleEntry(route: string, identity: PortalBootstrap, normalize: (name: string) => string) {
  const role = roles[identity?.profile?.role];
  if(!identity?.user?.id||identity.profile?.id!==identity.user.id||identity.profile?.approval_status!=='approved'||!role)throw new Error('Onaylanmış çalışan oturumu gerekli.');
  const name=normalize(route);
  const canonical=(value:string)=>{try{return normalize(value);}catch{return null;}};
  const permitted=(item:EntryRule)=>(!item.roles||item.roles.includes(role))&&(!item.adminOnly||role==='admin')&&(!item.capability||identity.capabilities?.[item.capability]===true);
  const matches=modules.filter(module=>module.variants.some(variant=>variant.route&&canonical(variant.route)===name));
  if(!matches.length)throw new Error('Bu ekran doğrudan açılabilen bir çalışan modülü değil.');
  if(!matches.some(module=>permitted(module)&&module.variants.some(variant=>variant.route&&canonical(variant.route)===name&&permitted(variant))))throw new Error('Bu çalışan modülü için erişiminiz veya gerekli servis bağlantısı bulunmuyor.');
  return name;
}
