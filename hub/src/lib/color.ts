import * as Color from 'color-bits';

/**
 * Convert any CSS color string to an RGBA string for canvas/SVG rendering.
 * Used by FlickeringGrid and LineChart components.
 */
export function getRGBA(
  cssColor: string,
  fallback: string = 'rgba(180, 180, 180)'
): string {
  if (typeof window === 'undefined') return fallback;
  if (!cssColor) return fallback;
  try {
    if (cssColor.startsWith('var(')) {
      const element = document.createElement('div');
      element.style.color = cssColor;
      document.body.appendChild(element);
      const computedColor = window.getComputedStyle(element).color;
      document.body.removeChild(element);
      return Color.formatRGBA(Color.parse(computedColor));
    }
    return Color.formatRGBA(Color.parse(cssColor));
  } catch {
    return fallback;
  }
}

/**
 * Add opacity to an RGB/RGBA color string.
 * Returns the color with the specified opacity applied.
 */
export function colorWithOpacity(color: string, opacity: number): string {
  if (!color.startsWith('rgb')) return color;
  return Color.formatRGBA(Color.alpha(Color.parse(color), opacity));
}
