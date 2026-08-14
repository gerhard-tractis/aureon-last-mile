import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ExpandCartonSheet } from './ExpandCartonSheet';

describe('ExpandCartonSheet', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    parentLabel: 'CTN001',
    existingBoxCount: 1,
    onConfirm: vi.fn(),
  };

  it('renders the parent label in the title', () => {
    render(<ExpandCartonSheet {...defaultProps} />);
    expect(screen.getByText(/Agregar bultos a CTN001/)).toBeInTheDocument();
  });

  it('defaults the stepper to 1 and previews CTN001-2', () => {
    render(<ExpandCartonSheet {...defaultProps} />);
    expect(screen.getByTestId('box-count')).toHaveTextContent('1');
    expect(screen.getByTestId('expand-preview')).toHaveTextContent('CTN001-2');
  });

  it('stepper increments and decrements within 1..20', () => {
    render(<ExpandCartonSheet {...defaultProps} />);
    const dec = screen.getByLabelText('Menos');
    const inc = screen.getByLabelText('Más');

    expect(dec).toBeDisabled();

    fireEvent.click(inc);
    expect(screen.getByTestId('box-count')).toHaveTextContent('2');
    expect(dec).not.toBeDisabled();

    fireEvent.click(dec);
    expect(screen.getByTestId('box-count')).toHaveTextContent('1');
  });

  it('caps the stepper at 20', () => {
    render(<ExpandCartonSheet {...defaultProps} />);
    const inc = screen.getByLabelText('Más');
    for (let i = 0; i < 25; i++) fireEvent.click(inc);
    expect(screen.getByTestId('box-count')).toHaveTextContent('20');
    expect(inc).toBeDisabled();
  });

  it('preview lists the exact labels to be created', () => {
    render(<ExpandCartonSheet {...defaultProps} />);
    fireEvent.click(screen.getByLabelText('Más'));
    fireEvent.click(screen.getByLabelText('Más'));
    expect(screen.getByTestId('expand-preview')).toHaveTextContent('CTN001-2, CTN001-3, CTN001-4');
  });

  it('preview accounts for previously minted siblings', () => {
    render(<ExpandCartonSheet {...defaultProps} existingBoxCount={3} />);
    expect(screen.getByTestId('expand-preview')).toHaveTextContent('CTN001-4');
  });

  it('disables Confirm until a reason is entered', () => {
    render(<ExpandCartonSheet {...defaultProps} />);
    expect(screen.getByRole('button', { name: /confirmar/i })).toBeDisabled();
  });

  it('a quick-pick reason fills the textarea and enables Confirm', () => {
    render(<ExpandCartonSheet {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Producto de varias cajas' }));
    expect(screen.getByLabelText('Motivo')).toHaveValue('Producto de varias cajas');
    expect(screen.getByRole('button', { name: /confirmar/i })).not.toBeDisabled();
  });

  it('typing a reason enables Confirm', () => {
    render(<ExpandCartonSheet {...defaultProps} />);
    fireEvent.change(screen.getByLabelText('Motivo'), { target: { value: 'Motivo libre' } });
    expect(screen.getByRole('button', { name: /confirmar/i })).not.toBeDisabled();
  });

  it('calls onConfirm with the count and trimmed reason', () => {
    const onConfirm = vi.fn();
    render(<ExpandCartonSheet {...defaultProps} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByLabelText('Más'));
    fireEvent.change(screen.getByLabelText('Motivo'), { target: { value: '  Motivo libre  ' } });
    fireEvent.click(screen.getByRole('button', { name: /confirmar/i }));
    expect(onConfirm).toHaveBeenCalledWith(2, 'Motivo libre');
  });

  it('shows a submitting state and disables Confirm/Cancel', () => {
    render(<ExpandCartonSheet {...defaultProps} isSubmitting />);
    expect(screen.getByRole('button', { name: /creando/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /cancelar/i })).toBeDisabled();
  });

  it('resets count and reason when closed and reopened', () => {
    const { rerender } = render(<ExpandCartonSheet {...defaultProps} />);
    fireEvent.click(screen.getByLabelText('Más'));
    fireEvent.change(screen.getByLabelText('Motivo'), { target: { value: 'algo' } });

    fireEvent.click(screen.getByRole('button', { name: /cancelar/i }));

    rerender(<ExpandCartonSheet {...defaultProps} open={true} />);
    expect(screen.getByTestId('box-count')).toHaveTextContent('1');
    expect(screen.getByLabelText('Motivo')).toHaveValue('');
  });
});
