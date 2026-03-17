import { cn } from '../../lib/cn.js';
import { motion, useInView, cubicBezier } from 'motion/react';
import React, { useEffect, useRef, useState } from 'react';

export interface OrbitingCirclesProps {
  /** Optional CSS class name */
  className?: string;
  /** Elements to orbit around the center */
  children?: React.ReactNode;
  /** Reverse the orbit direction */
  reverse?: boolean;
  /** Base orbit duration in seconds @default 20 */
  duration?: number;
  /** Animation delay in seconds @default 0 */
  delay?: number;
  /** Orbit radius in pixels @default 160 */
  radius?: number;
  /** Whether to show the orbital path ring @default true */
  path?: boolean;
  /** Size of each orbiting icon in pixels @default 30 */
  iconSize?: number;
  /** Speed multiplier for orbit animation @default 1 */
  speed?: number;
  /** Stagger index for entrance animation @default 0 */
  index?: number;
  /** Delay before entrance animation starts (seconds) @default 0 */
  startAnimationDelay?: number;
  /** Whether to only animate once (vs re-animate on re-entry) @default false */
  once?: boolean;
}

/**
 * Orbiting circles component that animates children in a circular orbit.
 * Uses CSS keyframe animation (animate-orbit) for continuous rotation and
 * motion/react spring animations for entrance effects.
 * Styled for the Hub dark theme with subtle border and gradient ring.
 */
export function OrbitingCircles({
  className,
  children,
  reverse,
  duration = 20,
  radius = 160,
  path = true,
  iconSize = 30,
  speed = 1,
  index = 0,
  startAnimationDelay = 0,
  once = false,
}: OrbitingCirclesProps) {
  const calculatedDuration = duration / speed;

  const ref = useRef(null);
  const isInView = useInView(ref, { once });
  const [shouldAnimate, setShouldAnimate] = useState(false);

  useEffect(() => {
    if (isInView) {
      setShouldAnimate(true);
    } else {
      setShouldAnimate(false);
    }
  }, [isInView]);

  return (
    <>
      {path && (
        <motion.div ref={ref}>
          {shouldAnimate && (
            <motion.div
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{
                duration: 0.8,
                ease: [0.23, 1, 0.32, 1],
                delay: index * 0.2 + startAnimationDelay,
                type: 'spring',
                stiffness: 120,
                damping: 18,
                mass: 1,
              }}
              className="pointer-events-none absolute inset-0"
              style={{
                width: radius * 2,
                height: radius * 2,
                left: `calc(50% - ${radius}px)`,
                top: `calc(50% - ${radius}px)`,
              }}
            >
              <div
                className={cn(
                  'size-full rounded-full',
                  'border border-white/[0.06]',
                  'bg-gradient-to-b from-white/[0.03] from-0% via-transparent via-[54.76%]',
                  className,
                )}
              />
            </motion.div>
          )}
        </motion.div>
      )}
      {shouldAnimate &&
        React.Children.map(children, (child, childIndex) => {
          const angle =
            (360 / React.Children.count(children)) * childIndex;
          return (
            <div
              style={
                {
                  '--duration': calculatedDuration,
                  '--radius': radius * 0.98,
                  '--angle': angle,
                  '--icon-size': `${iconSize}px`,
                } as React.CSSProperties
              }
              className={cn(
                'absolute flex size-[var(--icon-size)] z-20 p-1 transform-gpu animate-orbit items-center justify-center rounded-full',
                { '[animation-direction:reverse]': reverse },
              )}
            >
              <motion.div
                key={`orbit-child-${childIndex}`}
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{
                  duration: 0.5,
                  delay: 0.6 + childIndex * 0.2 + startAnimationDelay,
                  ease: cubicBezier(0, 0, 0.58, 1),
                  type: 'spring',
                  stiffness: 120,
                  damping: 18,
                  mass: 1,
                }}
              >
                {child}
              </motion.div>
            </div>
          );
        })}
    </>
  );
}
