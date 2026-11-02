import { useCallback, useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { calculateGridLayout } from './gridLayout';
import type { GridLayoutOptions } from './gridLayout';
import { useModuleDimensions } from './moduleDimensions';

interface MeasuredGridOptions extends GridLayoutOptions {
  horizontalPadding?: number;
  maxWidth?: number;
}

export function useMeasuredGrid(options: MeasuredGridOptions = {}) {
  const { width } = useModuleDimensions();
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);
  const onGridLayout = useCallback((event: LayoutChangeEvent) => {
    const nextWidth = event.nativeEvent.layout.width;
    if (Number.isFinite(nextWidth) && nextWidth >= 0) setMeasuredWidth(nextWidth);
  }, []);
  const fallbackWidth = Math.min(options.maxWidth ?? Infinity, Math.max(0, width - (options.horizontalPadding ?? 0) * 2));
  return { ...calculateGridLayout(measuredWidth ?? fallbackWidth, options), onGridLayout };
}
