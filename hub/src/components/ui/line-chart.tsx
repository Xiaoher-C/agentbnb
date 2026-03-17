import { getRGBA, colorWithOpacity } from '../../lib/color.js';
import { motion, useInView } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';

interface LineChartProps {
  /** Array of numeric data points to plot */
  data: number[];
  /** SVG viewBox height @default 200 */
  height?: number;
  /** SVG viewBox width @default 600 */
  width?: number;
  /** Line and gradient color (any CSS color) */
  color: string;
  /**
   * Whether the chart should animate. If not provided, animation is
   * triggered automatically via IntersectionObserver when the chart
   * scrolls into view.
   */
  shouldAnimate?: boolean;
  /** Delay in seconds before the animation starts @default 0 */
  startAnimationDelay?: number;
}

/**
 * SVG line chart with smooth bezier curves and animated line drawing.
 * Features gradient fill, center dot indicator, and pulsing wave effects.
 * Supports both explicit shouldAnimate control and automatic IntersectionObserver triggering.
 */
export function LineChart({
  data,
  height = 200,
  width = 600,
  color,
  shouldAnimate: shouldAnimateProp,
  startAnimationDelay = 0,
}: LineChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const inViewRef = useRef<SVGSVGElement>(null);
  const isInView = useInView(inViewRef, { once: true });

  // Use explicit prop if provided; otherwise derive from IntersectionObserver
  const shouldAnimate =
    shouldAnimateProp !== undefined ? shouldAnimateProp : isInView;

  // Create smooth curve points using bezier curves
  const createSmoothPath = (points: { x: number; y: number }[]) => {
    if (points.length < 2) return '';

    const path = points.reduce((acc, point, i, arr) => {
      if (i === 0) {
        return `M ${point.x} ${point.y}`;
      }

      const prev = arr[i - 1];
      const next = arr[i + 1];
      const smoothing = 0.2;

      if (i === arr.length - 1) {
        return `${acc} L ${point.x} ${point.y}`;
      }

      // Calculate control points for smooth bezier curve
      const cp1x = prev.x + (point.x - prev.x) * smoothing;
      const cp1y = prev.y + (point.y - prev.y) * smoothing;
      const cp2x = point.x - (next.x - prev.x) * smoothing;
      const cp2y = point.y - (next.y - prev.y) * smoothing;

      return `${acc} C ${cp1x},${cp1y} ${cp2x},${cp2y} ${point.x},${point.y}`;
    }, '');

    return path;
  };

  // Convert data points to SVG coordinates
  const maxValue = Math.max(...data);
  const coordinates = data.map((value, index) => ({
    x: (index / (data.length - 1)) * width,
    y: height - (value / maxValue) * height * 0.8,
  }));

  const smoothPath = createSmoothPath(coordinates);

  // Middle point for the indicator dot and pulse waves
  const middleIndex = Math.floor(data.length / 2);
  const middlePoint = coordinates[middleIndex];

  const [showPulse, setShowPulse] = useState(false);

  useEffect(() => {
    if (!shouldAnimate) {
      setShowPulse(false);
      return;
    }

    const timeoutId = setTimeout(() => {
      setShowPulse(true);
    }, startAnimationDelay * 1000);

    return () => clearTimeout(timeoutId);
  }, [shouldAnimate, startAnimationDelay]);

  const [computedColor, setComputedColor] = useState(color);

  useEffect(() => {
    setComputedColor(getRGBA(color));
  }, [color]);

  const getColorWithOpacity = useCallback(
    (opacity: number) => colorWithOpacity(computedColor, opacity),
    [computedColor],
  );

  // Merge both refs onto the SVG element
  const setRefs = useCallback(
    (node: SVGSVGElement | null) => {
      (svgRef as React.MutableRefObject<SVGSVGElement | null>).current = node;
      (inViewRef as React.MutableRefObject<SVGSVGElement | null>).current =
        node;
    },
    [],
  );

  return (
    <svg
      ref={setRefs}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Gradient Definition */}
      <defs>
        <linearGradient id="lineGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={getColorWithOpacity(0.3)} />
          <stop offset="100%" stopColor={getColorWithOpacity(0)} />
        </linearGradient>
      </defs>

      {/* Animated Area Fill */}
      <motion.path
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{
          opacity: shouldAnimate ? 1 : 0,
          scale: shouldAnimate ? 1 : 0.95,
        }}
        transition={{
          duration: 0.8,
          ease: 'easeOut',
          delay: startAnimationDelay,
        }}
        d={`${smoothPath} L ${width},${height} L 0,${height} Z`}
        fill="url(#lineGradient)"
      />

      {/* Animated Line */}
      <motion.path
        initial={{ pathLength: 0 }}
        animate={{ pathLength: shouldAnimate ? 1 : 0 }}
        transition={{
          duration: 1.5,
          ease: 'easeInOut',
          delay: startAnimationDelay,
        }}
        d={smoothPath}
        stroke={color}
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
      />

      {/* Center dot with scale animation */}
      <motion.circle
        cx={middlePoint.x}
        cy={middlePoint.y}
        r="4"
        fill={color}
        initial={{ scale: 0, opacity: 0 }}
        animate={{
          scale: shouldAnimate ? 1 : 0,
          opacity: shouldAnimate ? 1 : 0,
        }}
        transition={{
          delay: startAnimationDelay + 0.3,
          duration: 0.4,
          ease: 'backOut',
        }}
      />

      {/* Multiple pulsing waves */}
      {showPulse && (
        <>
          {[0, 1, 2].map((waveIndex) => (
            <motion.circle
              key={waveIndex}
              cx={middlePoint.x}
              cy={middlePoint.y}
              r="10"
              stroke={color}
              strokeWidth="2"
              fill="none"
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{
                scale: [0.5, 2],
                opacity: [0.8, 0],
              }}
              transition={{
                duration: 2,
                repeat: Infinity,
                delay: waveIndex * 0.67,
                ease: 'easeOut',
                times: [0, 1],
                repeatDelay: 0,
              }}
            />
          ))}
        </>
      )}
    </svg>
  );
}
