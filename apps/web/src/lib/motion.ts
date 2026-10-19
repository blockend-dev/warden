"use client";

// Thin wrappers over anime.js so every animation in the app respects
// prefers-reduced-motion and cleans up after itself. Components call these
// instead of importing anime.js directly.

import { useEffect, useRef, useState, type RefObject } from "react";
import { animate, stagger } from "animejs";

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function show(targets: Element[]): void {
  for (const el of targets) (el as HTMLElement).style.opacity = "1";
}

/** Staggered entrance for every `[data-reveal]` descendant of `ref`. Re-runs
 * when `deps` change (e.g. a list that grows). Already-revealed nodes are
 * left alone so a re-render doesn't replay the whole page. */
export function useReveal<T extends HTMLElement>(ref: RefObject<T | null>, deps: unknown[] = []): void {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const fresh = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]")).filter((el) => el.dataset.revealed !== "1");
    if (fresh.length === 0) return;
    for (const el of fresh) el.dataset.revealed = "1";
    if (prefersReducedMotion()) {
      show(fresh);
      return;
    }
    const anim = animate(fresh, {
      opacity: [0, 1],
      translateY: [18, 0],
      scale: [0.985, 1],
      duration: 750,
      delay: stagger(70),
      ease: "outExpo"
    });
    return () => {
      anim.pause();
      show(fresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** Animates a number from its previous value to `target`. */
export function useCountUp(target: number, duration = 900): number {
  const [value, setValue] = useState(target);
  const prev = useRef(target);

  useEffect(() => {
    if (prefersReducedMotion() || prev.current === target) {
      setValue(target);
      prev.current = target;
      return;
    }
    const state = { v: prev.current };
    const anim = animate(state, {
      v: target,
      duration,
      ease: "outExpo",
      onUpdate: () => setValue(Math.round(state.v))
    });
    prev.current = target;
    return () => {
      anim.pause();
    };
  }, [target, duration]);

  return value;
}

/** A short horizontal shake — used when the circuit refuses something. */
export function shake(el: Element | null): void {
  if (!el || prefersReducedMotion()) return;
  animate(el, { translateX: [0, -9, 9, -6, 6, -3, 0], duration: 460, ease: "outQuad" });
}

/** A soft scale-and-fade confirmation pulse. */
export function pop(el: Element | null): void {
  if (!el || prefersReducedMotion()) return;
  animate(el, { scale: [1, 1.04, 1], duration: 520, ease: "outBack" });
}

/** Slides new list items in from the left. */
export function slideIn(targets: Element | Element[] | NodeListOf<Element> | null): void {
  if (!targets || prefersReducedMotion()) return;
  animate(targets as Element, { opacity: [0, 1], translateX: [-14, 0], duration: 480, ease: "outCubic" });
}

export { animate, stagger };
