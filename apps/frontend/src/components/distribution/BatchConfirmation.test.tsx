import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BatchConfirmation } from './BatchConfirmation';

describe('BatchConfirmation', () => {
  it('renders andén scan prompt', () => {
    render(
      <BatchConfirmation
        zoneName="Andén 1"
        zoneCode="DOCK-001"
        packageCount={5}
        onConfirm={vi.fn()}
        lastScan={null}
      />
    );
    expect(screen.getByText(/escanear andén/i)).toBeInTheDocument();
    expect(screen.getByText('DOCK-001')).toBeInTheDocument();
  });

  it('shows zone name and package count in summary', () => {
    render(
      <BatchConfirmation
        zoneName="Andén 1"
        zoneCode="DOCK-001"
        packageCount={5}
        onConfirm={vi.fn()}
        lastScan={null}
      />
    );
    expect(screen.getByText('Andén 1')).toBeInTheDocument();
    expect(screen.getByText(/5\s*paquetes/i)).toBeInTheDocument();
  });

  it('shows error when wrong andén code scanned', () => {
    render(
      <BatchConfirmation
        zoneName="Andén 1"
        zoneCode="DOCK-001"
        packageCount={5}
        onConfirm={vi.fn()}
        lastScan={{ success: false, message: 'Código incorrecto' }}
      />
    );
    expect(screen.getByText(/código incorrecto/i)).toBeInTheDocument();
  });

  it('calls onConfirm with the scanned code on Enter', () => {
    const onConfirm = vi.fn();
    render(
      <BatchConfirmation
        zoneName="Andén 1"
        zoneCode="DOCK-001"
        packageCount={5}
        onConfirm={onConfirm}
        lastScan={null}
      />
    );
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'DOCK-001' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onConfirm).toHaveBeenCalledWith('DOCK-001');
  });

  it('renders scanner input', () => {
    render(
      <BatchConfirmation
        zoneName="Andén 1"
        zoneCode="DOCK-001"
        packageCount={5}
        onConfirm={vi.fn()}
        lastScan={null}
      />
    );
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });
});
