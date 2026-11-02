import React, { createContext, forwardRef, useContext } from 'react';
import { Text as NativeText, TextInput as NativeTextInput, StyleSheet } from 'react-native';
import type { TextProps, TextInputProps } from 'react-native';

const TextParent = createContext(false);
const hosted = () => typeof window !== 'undefined' && !!(window as any).VoltGuardEmployeeModules;
const body = { fontFamily: 'Inter, system-ui, sans-serif', fontSize: 14, color: 'var(--vg-module-text-primary, #0a1628)' };
function familyFallback(style: TextProps['style'] | TextInputProps['style']) {
  const family = StyleSheet.flatten(style)?.fontFamily;
  return family === 'Inter' || family === 'Outfit' ? { fontFamily: `${family}, system-ui, sans-serif` } : null;
}

// Only imported app source uses these adapters. Icon libraries retain their
// own Text implementation/font, and nested text keeps its parent's type size.
export const SiteText = forwardRef<React.ElementRef<typeof NativeText>, TextProps>((props, ref) => {
  const nested = useContext(TextParent);
  if (!hosted()) return <NativeText {...props} ref={ref} />;
  return <TextParent.Provider value={true}><NativeText {...props} ref={ref} style={[!nested && body, props.style, familyFallback(props.style)]} /></TextParent.Provider>;
});
SiteText.displayName = 'SiteText';

export const SiteTextInput = forwardRef<NativeTextInput, TextInputProps>((props, ref) => (
  <NativeTextInput {...props} ref={ref} placeholderTextColor={props.placeholderTextColor ?? (hosted() ? 'var(--vg-module-text-faint, #5b6b7c)' : undefined)} style={[hosted() && body, props.style, hosted() && familyFallback(props.style)]} />
));
SiteTextInput.displayName = 'SiteTextInput';
