import manifest from '../../employee-modules.json';
import { getStaffCapabilities } from './supabaseClient';

export const MODULE_GROUPS = ['Başlangıç', ...manifest.groups];
export const EMPLOYEE_MODULES = [
  { id: 'uygulamalar', label: 'Çalışan uygulamaları', description: 'İşlerinizi, müşterilerinizi ve ekip çalışmalarını tek yerden yönetin.', group: 'Başlangıç', variants: [] },
  ...manifest.modules,
];
export function permitted(item, user, capabilities = getStaffCapabilities()) {
  return Boolean(user?.approved && (!item.roles || item.roles.includes(user.role)) && (!item.adminOnly || user.role === 'admin') && (!item.capability || capabilities[item.capability] === true));
}
export function moduleVariants(module, user, capabilities = getStaffCapabilities()) { return (module?.variants || []).filter(item => permitted(item, user, capabilities)); }
export function availableModules(user, capabilities = getStaffCapabilities()) { return EMPLOYEE_MODULES.filter(item => permitted(item, user, capabilities) && (item.id === 'uygulamalar' || moduleVariants(item, user, capabilities).length)); }
export function findEmployeeModule(id, user) { return availableModules(user).find(item => item.id === id); }
export function selectedVariant(module, user, query = window.location.search) {
  const variants = moduleVariants(module, user);
  return variants.find(item => item.id === new URLSearchParams(query).get('bolum')) || variants[0] || null;
}
export function employeeModuleURL(id, variant) {
  const query = new URLSearchParams({ module: id });
  if (variant) query.set('bolum', variant);
  return '/calisan/uygulama/?' + query;
}
export function initialEmployeeModule(user, query = window.location.search) {
  const id = new URLSearchParams(query).get('module');
  return findEmployeeModule(id, user)?.id || 'uygulamalar';
}
