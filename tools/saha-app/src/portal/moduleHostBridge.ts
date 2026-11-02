export type ModuleEvent = { type: string; [key: string]: any };
type Listener = (event: ModuleEvent) => void;
let root: HTMLElement | null = null;
let hostListener: Listener | null = null;
const listeners = new Set<Listener>();
export function connectModuleHost(node: HTMLElement, onEvent?: Listener) {
  root = node; hostListener = onEvent || null;
  return () => { if (root === node) { root = null; hostListener = null; } };
}
export function isModuleHost() { return root !== null; }
export function getModuleRoot() { return root; }
export function getModuleShadowRoot(): ShadowRoot | null {
  const scope = root?.getRootNode();
  return typeof ShadowRoot !== 'undefined' && scope instanceof ShadowRoot ? scope : null;
}
export function emitModuleEvent(type: string, fields: Record<string, any> = {}) {
  const event = { ...fields, type };
  try { hostListener?.(event); } catch (error) { console.warn('[employee-module.host]', error); }
  for (const listener of listeners) { try { listener(event); } catch (error) { console.warn('[employee-module.event]', error); } }
}
export function subscribeModuleEvents(listener: Listener) { listeners.add(listener); return () => { listeners.delete(listener); }; }
