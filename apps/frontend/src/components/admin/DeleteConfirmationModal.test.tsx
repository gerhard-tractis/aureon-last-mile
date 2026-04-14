import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DeleteConfirmationModal } from './DeleteConfirmationModal';

const defaultProps = {
  isOpen: true,
  entityName: 'Usuario',
  isPending: false,
  onConfirm: vi.fn(),
  onCancel: vi.fn(),
};

describe('DeleteConfirmationModal', () => {
  it('renders nothing when isOpen is false', () => {
    const { container } = render(<DeleteConfirmationModal {...defaultProps} isOpen={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders when isOpen is true', () => {
    render(<DeleteConfirmationModal {...defaultProps} />);
    expect(screen.getByText('Eliminar Usuario')).toBeDefined();
  });

  it('shows itemName in message when provided', () => {
    render(<DeleteConfirmationModal {...defaultProps} itemName="Easy" />);
    expect(screen.getByText(/Easy/)).toBeDefined();
  });

  it('shows warningText when provided', () => {
    render(<DeleteConfirmationModal {...defaultProps} warningText="This cannot be undone." />);
    expect(screen.getByText(/This cannot be undone/)).toBeDefined();
  });

  it('calls onCancel when Cancelar is clicked', () => {
    const onCancel = vi.fn();
    render(<DeleteConfirmationModal {...defaultProps} onCancel={onCancel} />);
    fireEvent.click(screen.getByText('Cancelar'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('calls onConfirm when Eliminar is clicked', () => {
    const onConfirm = vi.fn();
    render(<DeleteConfirmationModal {...defaultProps} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByText('Eliminar'));
    expect(onConfirm).toHaveBeenCalled();
  });

  it('disables buttons when isPending', () => {
    render(<DeleteConfirmationModal {...defaultProps} isPending={true} />);
    expect(screen.getByText('Cancelar')).toBeDisabled();
    expect(screen.getByText('Eliminando...')).toBeDisabled();
  });

  it('disables confirm button when isDisabled', () => {
    render(<DeleteConfirmationModal {...defaultProps} isDisabled={true} />);
    expect(screen.getByText('Eliminar')).toBeDisabled();
  });
});
