import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DiscrepancyItem } from './DiscrepancyItem';

describe('DiscrepancyItem', () => {
  const defaultProps = {
    packageId: 'pkg-1',
    packageLabel: 'CTN001',
    orderNumber: 'ORD-100',
    existingNote: '',
    onSaveNote: vi.fn(),
  };

  it('renders package label and order number', () => {
    render(<DiscrepancyItem {...defaultProps} />);
    expect(screen.getByText('CTN001')).toBeInTheDocument();
    expect(screen.getByText('Order: ORD-100')).toBeInTheDocument();
  });

  it('renders textarea with aria-label', () => {
    render(<DiscrepancyItem {...defaultProps} />);
    expect(
      screen.getByLabelText('Note for package CTN001')
    ).toBeInTheDocument();
  });

  it('shows existing note', () => {
    render(
      <DiscrepancyItem {...defaultProps} existingNote="Damaged box" />
    );
    const textarea = screen.getByLabelText(
      'Note for package CTN001'
    ) as HTMLTextAreaElement;
    expect(textarea.value).toBe('Damaged box');
  });

  it('calls onSaveNote on blur with changed text', async () => {
    const onSaveNote = vi.fn();
    render(
      <DiscrepancyItem {...defaultProps} onSaveNote={onSaveNote} />
    );
    const textarea = screen.getByLabelText('Note for package CTN001');
    await userEvent.type(textarea, 'Missing from pallet');
    fireEvent.blur(textarea);
    expect(onSaveNote).toHaveBeenCalledWith('pkg-1', 'Missing from pallet');
  });

  it('does not call onSaveNote on blur with empty text', () => {
    const onSaveNote = vi.fn();
    render(
      <DiscrepancyItem {...defaultProps} onSaveNote={onSaveNote} />
    );
    const textarea = screen.getByLabelText('Note for package CTN001');
    fireEvent.blur(textarea);
    expect(onSaveNote).not.toHaveBeenCalled();
  });
});
