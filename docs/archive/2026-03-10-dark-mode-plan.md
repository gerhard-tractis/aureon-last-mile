# Dark Mode Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add dark mode with system preference default and manual toggle, using a `useTheme` hook + `ThemeToggle` button in the app header.

**Architecture:** Class-based dark mode via Tailwind's existing `darkMode: ["class"]` config. `.dark` applied to `<html>` (alongside the existing per-operator theme class on `<body>`). An inline script in `<head>` prevents flash of light mode on load. `useTheme` hook manages state + localStorage + OS preference sync.

**Tech Stack:** Vitest, React Testing Library, lucide-react (already installed), localStorage, `matchMedia` API.

---

### Task 1: `useTheme` hook

**Files:**
- Create: `apps/frontend/src/hooks/useTheme.ts`
- Create: `apps/frontend/src/hooks/useTheme.test.ts`

**Step 1: Write the failing tests**

Create `apps/frontend/src/hooks/useTheme.test.ts`:

```typescript
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useTheme } from './useTheme';

const mockMatchMedia = (matches: boolean) => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
};

describe('useTheme', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
    mockMatchMedia(false);
  });

  it('defaults to light when OS is light and no stored value', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.isDark).toBe(false);
  });

  it('defaults to dark when OS is dark and no stored value', () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useTheme());
    expect(result.current.isDark).toBe(true);
  });

  it('uses stored dark preference over OS', () => {
    mockMatchMedia(false); // OS is light
    localStorage.setItem('aureon-theme', 'dark');
    const { result } = renderHook(() => useTheme());
    expect(result.current.isDark).toBe(true);
  });

  it('uses stored light preference over OS', () => {
    mockMatchMedia(true); // OS is dark
    localStorage.setItem('aureon-theme', 'light');
    const { result } = renderHook(() => useTheme());
    expect(result.current.isDark).toBe(false);
  });

  it('toggle() flips dark state', () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.toggle());
    expect(result.current.isDark).toBe(true);
  });

  it('toggle() writes preference to localStorage', () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.toggle());
    expect(localStorage.getItem('aureon-theme')).toBe('dark');
  });

  it('applies .dark class to <html> when isDark is true', () => {
    localStorage.setItem('aureon-theme', 'dark');
    renderHook(() => useTheme());
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('removes .dark class from <html> when isDark is false', () => {
    document.documentElement.classList.add('dark');
    localStorage.setItem('aureon-theme', 'light');
    renderHook(() => useTheme());
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
cd apps/frontend && pnpm test src/hooks/useTheme.test.ts
```

Expected: FAIL — "Cannot find module './useTheme'"

**Step 3: Write the implementation**

Create `apps/frontend/src/hooks/useTheme.ts`:

```typescript
import { useEffect, useState } from 'react';

const STORAGE_KEY = 'aureon-theme';

function getInitialDark(): boolean {
  if (typeof window === 'undefined') return false;
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'dark') return true;
  if (stored === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function useTheme() {
  const [isDark, setIsDark] = useState(getInitialDark);

  // Apply/remove .dark on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [isDark]);

  // Listen for OS preference changes (only when no manual override is stored)
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setIsDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  function toggle() {
    setIsDark((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY, next ? 'dark' : 'light');
      return next;
    });
  }

  return { isDark, toggle };
}
```

**Step 4: Run tests to verify they pass**

```bash
cd apps/frontend && pnpm test src/hooks/useTheme.test.ts
```

Expected: All 8 tests PASS

**Step 5: Commit**

```bash
git add apps/frontend/src/hooks/useTheme.ts apps/frontend/src/hooks/useTheme.test.ts
git commit -m "feat(theme): add useTheme hook with localStorage + OS preference sync"
```

---

### Task 2: `ThemeToggle` component

**Files:**
- Create: `apps/frontend/src/components/ThemeToggle.tsx`
- Create: `apps/frontend/src/components/ThemeToggle.test.tsx`

**Step 1: Write the failing tests**

Create `apps/frontend/src/components/ThemeToggle.test.tsx`:

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/hooks/useTheme', () => ({
  useTheme: vi.fn(),
}));

import { useTheme } from '@/hooks/useTheme';
import ThemeToggle from './ThemeToggle';

describe('ThemeToggle', () => {
  beforeEach(() => {
    vi.mocked(useTheme).mockReturnValue({ isDark: false, toggle: vi.fn() });
  });

  it('renders a button with "switch to dark mode" label in light mode', () => {
    render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: /switch to dark mode/i })).toBeInTheDocument();
  });

  it('renders a button with "switch to light mode" label in dark mode', () => {
    vi.mocked(useTheme).mockReturnValue({ isDark: true, toggle: vi.fn() });
    render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: /switch to light mode/i })).toBeInTheDocument();
  });

  it('calls toggle when clicked', () => {
    const toggle = vi.fn();
    vi.mocked(useTheme).mockReturnValue({ isDark: false, toggle });
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole('button'));
    expect(toggle).toHaveBeenCalledOnce();
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
cd apps/frontend && pnpm test src/components/ThemeToggle.test.tsx
```

Expected: FAIL — "Cannot find module './ThemeToggle'"

**Step 3: Write the implementation**

Create `apps/frontend/src/components/ThemeToggle.tsx`:

```typescript
'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';

export default function ThemeToggle() {
  const { isDark, toggle } = useTheme();

  return (
    <button
      onClick={toggle}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="p-2 rounded-md text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-700 transition-colors"
    >
      {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  );
}
```

**Step 4: Run tests to verify they pass**

```bash
cd apps/frontend && pnpm test src/components/ThemeToggle.test.tsx
```

Expected: All 3 tests PASS

**Step 5: Commit**

```bash
git add apps/frontend/src/components/ThemeToggle.tsx apps/frontend/src/components/ThemeToggle.test.tsx
git commit -m "feat(theme): add ThemeToggle button component (Sun/Moon)"
```

---

### Task 3: SSR flash prevention script in `layout.tsx`

**Files:**
- Modify: `apps/frontend/src/app/layout.tsx:34-37`

**Note:** This is an inline script that runs before React hydrates. It cannot be unit-tested; verify manually by hard-refreshing with dark mode active.

**Step 1: Add inline script to `<head>` in `layout.tsx`**

In `apps/frontend/src/app/layout.tsx`, the `<head>` block is at lines 35-37. Add the script as the first child:

```diff
  <html lang="en">
  <head>
+   <script
+     dangerouslySetInnerHTML={{
+       __html: `(function(){try{var s=localStorage.getItem('aureon-theme');if(s==='dark'||(s===null&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark')}}catch(e){}})();`,
+     }}
+   />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
  </head>
```

**Step 2: Verify manually**

1. Run `pnpm dev` in `apps/frontend`
2. Open the app, toggle to dark mode
3. Hard-refresh (Ctrl+Shift+R) — page should load dark immediately with no flash

**Step 3: Commit**

```bash
git add apps/frontend/src/app/layout.tsx
git commit -m "feat(theme): add SSR flash-prevention script for dark mode"
```

---

### Task 4: Wire `ThemeToggle` into `AppLayout.tsx`

**Files:**
- Modify: `apps/frontend/src/components/AppLayout.tsx:131,139`

**Step 1: Import ThemeToggle**

In `apps/frontend/src/components/AppLayout.tsx`, add the import after existing imports:

```diff
+ import ThemeToggle from '@/components/ThemeToggle';
```

**Step 2: Add `ThemeToggle` to header and fix header dark mode background**

The header `<div>` is at line 131. Make two changes:

```diff
- <div className="sticky top-0 z-10 flex items-center justify-between h-16 bg-white shadow-sm px-4">
+ <div className="sticky top-0 z-10 flex items-center justify-between h-16 bg-white dark:bg-gray-900 shadow-sm dark:shadow-gray-800 px-4">
```

Then add `<ThemeToggle>` before the user dropdown at line 139:

```diff
- <div className="relative ml-auto">
+ <div className="flex items-center gap-2 ml-auto">
+   <ThemeToggle />
+   <div className="relative">
```

Close the new inner div after the dropdown closes (after the `isUserDropdownOpen` block, before the outer div closes).

The resulting structure:
```tsx
<div className="flex items-center gap-2 ml-auto">
  <ThemeToggle />
  <div className="relative">
    {/* user dropdown button + menu */}
  </div>
</div>
```

**Step 3: Verify visually**

1. Open dashboard, confirm toggle is visible in header
2. Click toggle — dashboard switches between light and dark
3. Refresh — mode persists
4. Check mobile view — toggle should be visible alongside the mobile menu button

**Step 4: Commit**

```bash
git add apps/frontend/src/components/AppLayout.tsx
git commit -m "feat(theme): wire ThemeToggle into app header"
```

---

### Task 5: Branch, PR, auto-merge

**Step 1: Verify all tests pass**

```bash
cd apps/frontend && pnpm test
```

Expected: all tests pass, no regressions

**Step 2: Push and create PR**

```bash
git push origin <current-branch>
gh pr create --title "feat(dashboard): add dark mode with system preference + manual toggle" --body "..."
gh pr merge --auto --squash <PR-number>
```

**Step 3: Confirm CI passes and PR merges**

```bash
gh pr checks <PR-number>
gh pr view <PR-number> --json state,mergedAt
```

Wait until `state: MERGED` before declaring done.
