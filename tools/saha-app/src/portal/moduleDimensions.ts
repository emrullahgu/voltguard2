import { useEffect, useState } from 'react';
import { getModuleRoot } from './moduleHostBridge';
export function getModuleDimensions() {
  const node = getModuleRoot(), rect = node?.getBoundingClientRect();
  return {
    width: Math.max(1, Math.round(rect ? rect.width : window.innerWidth)),
    height: Math.max(1, Math.round(rect ? rect.height : window.innerHeight)),
    scale: window.devicePixelRatio || 1,
    fontScale: 1,
  };
}
export function useModuleDimensions() {
  const [size, setSize] = useState(getModuleDimensions);
  useEffect(() => {
    const update = () => setSize(previous => {
      const next = getModuleDimensions();
      return previous.width === next.width && previous.height === next.height && previous.scale === next.scale ? previous : next;
    });
    update();
    const node = getModuleRoot();
    const observer = typeof ResizeObserver !== 'undefined' && node ? new ResizeObserver(update) : null;
    if (node) observer?.observe(node);
    window.addEventListener('resize', update);
    return () => { observer?.disconnect(); window.removeEventListener('resize', update); };
  }, []);
  return size;
}
