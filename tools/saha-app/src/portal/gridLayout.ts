export type GridGap = number | `${number}%`;
export type GridBreakpoints = readonly (readonly [minWidth: number, columns: number])[];

export const DEFAULT_GRID_BREAKPOINTS: GridBreakpoints = [[900, 4], [520, 2]];

export interface GridLayoutOptions {
  gap?: GridGap;
  breakpoints?: GridBreakpoints;
}

// Width is the grid's own content width, after scrollbars and outer padding.
export function calculateGridLayout(measuredWidth: number, options: GridLayoutOptions = {}) {
  const width = Number.isFinite(measuredWidth) ? Math.max(0, measuredWidth) : 0;
  const { gap = 12, breakpoints = DEFAULT_GRID_BREAKPOINTS } = options;
  let columns = 1;
  let selectedMinWidth = 0;
  for (const [minWidth, count] of breakpoints) {
    if (width >= minWidth && minWidth >= selectedMinWidth) {
      columns = Math.max(1, Math.floor(count));
      selectedMinWidth = minWidth;
    }
  }
  const gapWidth = typeof gap === 'string' ? width * Number.parseFloat(gap) / 100 : gap;
  // Rounding down keeps a fractional CSS pixel from moving the last tile to a new row.
  const tileWidth = Math.max(0, Math.floor((width - Math.max(0, gapWidth) * (columns - 1)) / columns));
  return { columns, tileWidth };
}
