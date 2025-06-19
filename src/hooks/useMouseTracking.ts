import { useEffect, useRef } from 'react';

export function useMouseTracking(onEnter: () => void, onLeave: () => void) {
  const elementRef = useRef<HTMLDivElement>(null);
  const isInsideRef = useRef(false);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    // Use a global mouse move listener to detect hover
    // This might work better for windows without focus
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (!element) return;
      
      const rect = element.getBoundingClientRect();
      const isInside = (
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom
      );

      if (isInside && !isInsideRef.current) {
        isInsideRef.current = true;
        console.log('🖱️ Global mouse tracking: entered');
        onEnter();
      } else if (!isInside && isInsideRef.current) {
        isInsideRef.current = false;
        console.log('🖱️ Global mouse tracking: left');
        onLeave();
      }
    };

    // Listen to mousemove on the window
    window.addEventListener('mousemove', handleGlobalMouseMove, true);
    
    // Also use regular mouse events as fallback
    const handleMouseEnter = () => {
      if (!isInsideRef.current) {
        isInsideRef.current = true;
        console.log('🖱️ Regular mouse enter');
        onEnter();
      }
    };

    const handleMouseLeave = () => {
      if (isInsideRef.current) {
        isInsideRef.current = false;
        console.log('🖱️ Regular mouse leave');
        onLeave();
      }
    };

    element.addEventListener('mouseenter', handleMouseEnter);
    element.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove, true);
      element.removeEventListener('mouseenter', handleMouseEnter);
      element.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [onEnter, onLeave]);

  return elementRef;
}