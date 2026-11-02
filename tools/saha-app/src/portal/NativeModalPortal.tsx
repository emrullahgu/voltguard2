import React, { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { getModuleShadowRoot } from './moduleHostBridge';
export default function NativeModalPortal({ children }: { children: React.ReactNode }) {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const parent = getModuleShadowRoot() || document.body;
    const node = document.createElement('div'); node.dataset.employeeModulePortal = 'true';
    parent.appendChild(node); setElement(node);
    return () => { node.remove(); };
  }, []);
  return element ? createPortal(children, element) : null;
}
