type LayoutNotice = { height: number | null; mode: 'document' | 'workspace' };

// These screens have meaningful independent viewports (maps, conversations,
// boards and camera input), rather than a single document to expand.
const WORKSPACE_ROUTE = /(?:Map|Kanban|Board|Chat|Messages|Tracking|LocationHistory|Geofence|Scanner|Scan$|OperationReplay|LiveOps|FieldCommandCenter)/;
const HEIGHT_PROPERTY = '--vg-module-content-height';

export function observeModuleDocument(root: HTMLElement, host: HTMLElement, initialRoute: string, onSize?: (notice: LayoutNotice) => void) {
  let route = initialRoute;
  let frame = 0;
  let stopped = false;
  let content: HTMLElement | null = null;
  let restoreContent: (() => void) | null = null;
  let lastHeight: number | null = null;
  let lastMode: LayoutNotice['mode'] | null = null;
  const maximum = () => Math.max(1400, Math.min(4800, window.innerHeight * 4));
  const notify = (height: number | null, mode: LayoutNotice['mode']) => {
    if (height === lastHeight && mode === lastMode) return;
    lastHeight = height; lastMode = mode;
    if (height === null) host.style.removeProperty(HEIGHT_PROPERTY);
    else host.style.setProperty(HEIGHT_PROPERTY, `${height}px`);
    host.dataset.moduleLayout = mode;
    onSize?.({ height, mode });
  };
  const visible = (node: HTMLElement) => {
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && !node.closest('[hidden],[aria-hidden="true"],[role="dialog"],[aria-modal="true"]') && getComputedStyle(node).visibility !== 'hidden';
  };
  const measure = () => {
    frame = 0;
    if (stopped || !root.isConnected) return;
    if (WORKSPACE_ROUTE.test(route)) { notify(null, 'workspace'); return; }
    const rootRect = root.getBoundingClientRect();
    const viewport = Array.from(root.querySelectorAll<HTMLElement>('div')).find(node => {
      if (!visible(node) || node.children.length !== 1) return false;
      const style = getComputedStyle(node), rect = node.getBoundingClientRect();
      return ['auto', 'scroll'].includes(style.overflowY) && style.flexDirection === 'column' && rect.width >= rootRect.width * .85;
    });
    const nextContent = viewport?.firstElementChild as HTMLElement | null;
    if (nextContent !== content) {
      restoreContent?.(); restoreContent = null;
      observer?.disconnect(); observer?.observe(root);
      content = nextContent;
      if (content) {
        const target = content;
        const grow = target.style.getPropertyValue('flex-grow');
        const minimum = target.style.getPropertyValue('min-height');
        target.style.setProperty('flex-grow', '0');
        target.style.setProperty('min-height', '0');
        restoreContent = () => {
          if (grow) target.style.setProperty('flex-grow', grow); else target.style.removeProperty('flex-grow');
          if (minimum) target.style.setProperty('min-height', minimum); else target.style.removeProperty('min-height');
        };
        observer?.observe(content);
      }
    }
    if (!viewport || !content || !visible(content)) { notify(null, 'workspace'); return; }
    const offset = Math.max(0, viewport.getBoundingClientRect().top - rootRect.top);
    const desired = Math.ceil(offset + content.getBoundingClientRect().height + 2);
    const limit = maximum();
    // A virtualized or very large list remains a bounded workspace. Expanding
    // it indefinitely would defeat virtualization and hide useful page context.
    notify(Math.max(240, Math.min(limit, desired)), desired <= limit ? 'document' : 'workspace');
  };
  const schedule = () => { if (!stopped && !frame) frame = window.requestAnimationFrame(measure); };
  const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
  observer?.observe(root);
  const mutations = typeof MutationObserver !== 'undefined' ? new MutationObserver(schedule) : null;
  mutations?.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'class', 'aria-hidden', 'hidden'] });
  window.addEventListener('resize', schedule);
  schedule();
  return {
    setRoute(next: string) {
      if (stopped || next === route) return;
      restoreContent?.(); restoreContent = null; content = null;
      observer?.disconnect(); observer?.observe(root);
      route = next; notify(null, 'workspace'); schedule();
    },
    disconnect() {
      stopped = true;
      if (frame) window.cancelAnimationFrame(frame);
      observer?.disconnect(); mutations?.disconnect();
      restoreContent?.(); restoreContent = null;
      window.removeEventListener('resize', schedule);
      host.style.removeProperty(HEIGHT_PROPERTY);
      delete host.dataset.moduleLayout;
    },
  };
}
