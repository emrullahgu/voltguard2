import React, { useEffect, useRef } from 'react';
import { getModuleShadowRoot } from './moduleHostBridge';
function activeElement(): Element | null { return getModuleShadowRoot()?.activeElement || document.activeElement; }
export default function NativeModalFocusTrap({ active, children }: { active: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!active) return;
    const previous = activeElement() as HTMLElement | null;
    let moving = false;
    const focusable = () => [...(ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])') || [])].filter(node => node.getClientRects().length > 0);
    const focusFirst = () => { if (moving) return; moving = true; (focusable()[0] || ref.current)?.focus(); moving = false; };
    const trap = () => { const focused = activeElement(); if (focused && !ref.current?.contains(focused)) focusFirst(); };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = focusable(), focused = activeElement();
      if (!items.length) { event.preventDefault(); ref.current?.focus(); return; }
      if (event.shiftKey && (focused === items[0] || !ref.current?.contains(focused))) { event.preventDefault(); items[items.length - 1].focus(); }
      else if (!event.shiftKey && (focused === items[items.length - 1] || !ref.current?.contains(focused))) { event.preventDefault(); items[0].focus(); }
    };
    focusFirst(); document.addEventListener('focusin', trap, true); document.addEventListener('keydown', keyboard, true);
    return () => { document.removeEventListener('focusin', trap, true); document.removeEventListener('keydown', keyboard, true); if (previous?.isConnected) previous.focus(); };
  }, [active]);
  return <div ref={ref} tabIndex={-1} style={{ outline: 'none' }}>{children}</div>;
}
