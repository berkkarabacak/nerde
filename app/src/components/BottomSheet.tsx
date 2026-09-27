// BottomSheet — custom snap-point sheet for the mobile place list
// (peek 72px — two text lines: count + tagline (UX_REVIEW F3/F4) — / half
// 50dvh / full 90dvh). Pointer drag on the handle area, snaps to the nearest
// point with a 200ms ease-out (DESIGN_SYSTEM §6.2).
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type SheetSnap = 'peek' | 'half' | 'full';

function snapToPx(snap: SheetSnap, viewportH: number): number {
  if (snap === 'peek') return 72;
  if (snap === 'half') return Math.round(viewportH * 0.5);
  return Math.round(viewportH * 0.9);
}

export default function BottomSheet({
  snap,
  onSnapChange,
  peekContent,
  children,
}: {
  snap: SheetSnap;
  onSnapChange: (snap: SheetSnap) => void;
  /** Single-line content visible in peek state (handle is always rendered). */
  peekContent: ReactNode;
  children: ReactNode;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const [dragOffset, setDragOffset] = useState<number | null>(null);
  const dragState = useRef<{ startY: number; startHeight: number; height: number } | null>(null);

  const viewportH = typeof window === 'undefined' ? 800 : window.innerHeight;
  const baseHeight = snapToPx(snap, viewportH);
  const height = dragOffset === null ? baseHeight : dragOffset;

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const el = sheetRef.current;
      if (!el) return;
      el.setPointerCapture(e.pointerId);
      dragState.current = { startY: e.clientY, startHeight: el.offsetHeight, height: el.offsetHeight };
      setDragOffset(el.offsetHeight);
    },
    [],
  );

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragState.current;
    if (!drag) return;
    const next = Math.min(
      Math.round(window.innerHeight * 0.92),
      Math.max(48, drag.startHeight + (drag.startY - e.clientY)),
    );
    drag.height = next;
    setDragOffset(next);
  }, []);

  const finishDrag = useCallback(() => {
    const drag = dragState.current;
    dragState.current = null;
    setDragOffset(null);
    if (!drag) return;
    const vh = window.innerHeight;
    const points: { snap: SheetSnap; px: number }[] = [
      { snap: 'peek', px: snapToPx('peek', vh) },
      { snap: 'half', px: snapToPx('half', vh) },
      { snap: 'full', px: snapToPx('full', vh) },
    ];
    const nearest = points.reduce((best, p) =>
      Math.abs(p.px - drag.height) < Math.abs(best.px - drag.height) ? p : best,
    );
    onSnapChange(nearest.snap);
  }, [onSnapChange]);

  useEffect(() => {
    const cancel = () => {
      dragState.current = null;
      setDragOffset(null);
    };
    window.addEventListener('blur', cancel);
    return () => window.removeEventListener('blur', cancel);
  }, []);

  return (
    <div
      ref={sheetRef}
      className={cn(
        'absolute inset-x-0 bottom-0 z-20 flex flex-col rounded-t-xl border-t border-neutral-200 bg-white shadow-lg',
        dragOffset === null && 'transition-[height] duration-200 ease-out motion-reduce:transition-none',
      )}
      style={{ height }}
      role="region"
      aria-label="Places list"
    >
      <div
        className="cursor-grab touch-none select-none pt-2 active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
      >
        <div className="mx-auto h-1 w-10 rounded-full bg-neutral-300" aria-hidden="true" />
        <button
          type="button"
          className="flex w-full items-center justify-center px-4 py-1.5 text-xs text-neutral-600 focus-visible:outline-none"
          onClick={() => onSnapChange(snap === 'peek' ? 'half' : 'peek')}
          aria-label={snap === 'peek' ? 'Expand places list' : 'Collapse places list'}
        >
          {peekContent}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
    </div>
  );
}
