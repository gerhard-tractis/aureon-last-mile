// src/app/(landing)/components/__tests__/scroll-reveal.test.tsx
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock IntersectionObserver
const mockObserve = vi.fn();
const mockUnobserve = vi.fn();
const mockDisconnect = vi.fn();
let observerCallback: IntersectionObserverCallback;

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', function (cb: IntersectionObserverCallback) {
    observerCallback = cb;
    return { observe: mockObserve, unobserve: mockUnobserve, disconnect: mockDisconnect };
  });
});

import { ScrollReveal } from '../scroll-reveal';

describe('ScrollReveal', () => {
  it('renders children', () => {
    render(<ScrollReveal><p>Hello</p></ScrollReveal>);
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('starts with opacity-0 and translate-y', () => {
    const { container } = render(<ScrollReveal><p>Hello</p></ScrollReveal>);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain('opacity-0');
    expect(wrapper.className).toContain('translate-y-8');
  });

  it('becomes visible when intersecting', () => {
    const { container } = render(<ScrollReveal><p>Hello</p></ScrollReveal>);
    const wrapper = container.firstChild as HTMLElement;

    // Simulate intersection
    act(() => {
      observerCallback(
        [{ isIntersecting: true, target: wrapper }] as IntersectionObserverEntry[],
        {} as IntersectionObserver
      );
    });

    expect(wrapper.className).toContain('opacity-100');
    expect(wrapper.className).toContain('translate-y-0');
  });

  it('applies stagger delay', () => {
    const { container } = render(<ScrollReveal delay={200}><p>Hi</p></ScrollReveal>);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.style.transitionDelay).toBe('200ms');
  });
});
