import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReceptionMobileFooterActions } from './ReceptionMobileFooterActions';

describe('ReceptionMobileFooterActions', () => {
  const props = { onScanQR: vi.fn(), onNoQR: vi.fn() };

  it('calls onScanQR from the QR button', async () => {
    const onScanQR = vi.fn();
    render(<ReceptionMobileFooterActions {...props} onScanQR={onScanQR} />);
    await userEvent.click(screen.getByRole('button', { name: /Escanear QR/i }));
    expect(onScanQR).toHaveBeenCalledTimes(1);
  });

  it('calls onNoQR from the manual fallback', async () => {
    const onNoQR = vi.fn();
    render(<ReceptionMobileFooterActions {...props} onNoQR={onNoQR} />);
    await userEvent.click(screen.getByRole('button', { name: /Recibir sin QR/i }));
    expect(onNoQR).toHaveBeenCalledTimes(1);
  });

  describe('inner spacing', () => {
    // Both buttons are flex-1 on a ~390px screen, so each gets ~167px. The
    // label plus a 20px icon plus the gap consumed essentially all of it,
    // leaving the text and the QR glyph touching the button edges.
    // Reported from a Redmi Note 15 Pro.
    it.each([
      [/Escanear QR/i],
      [/Recibir sin QR/i],
    ])('keeps the label off the edges of %s', (name) => {
      render(<ReceptionMobileFooterActions {...props} />);
      expect(screen.getByRole('button', { name }).className).toContain('px-3');
    });

    it('labels the QR button exactly "Escanear QR", not the long form', () => {
      // The regex lookups elsewhere in this file match "Escanear QR de ruta"
      // as a substring, so they would NOT catch a revert to the long label.
      // A string matcher in Testing Library is exact, which is the point here:
      // the shorter label is what keeps the button off two lines at ~167px.
      render(<ReceptionMobileFooterActions {...props} />);
      expect(screen.getByRole('button', { name: 'Escanear QR' })).toBeInTheDocument();
    });

    it('lets the label shrink instead of overflowing once padding is added', () => {
      // Padding alone would push the text into overflow at this width, so the
      // flex child must be allowed to shrink below its content size --
      // min-w-0 is what makes that legal in a flex row.
      render(<ReceptionMobileFooterActions {...props} />);
      expect(screen.getByRole('button', { name: /Escanear QR/i }).className).toContain(
        'min-w-0',
      );
    });

    it('never lets the icons shrink to make room for the text', () => {
      // A squashed QR glyph is worse than a wrapped label: the icon is the
      // part an operator aims at with a gloved thumb.
      const { container } = render(<ReceptionMobileFooterActions {...props} />);
      const icons = container.querySelectorAll('svg');
      expect(icons).toHaveLength(2);
      icons.forEach((icon) => expect(icon.getAttribute('class')).toContain('flex-none'));
    });
  });
});
