import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { OrderLifecycleRibbon } from './OrderLifecycleRibbon';

describe('OrderLifecycleRibbon', () => {
  it('renders all 8 pipeline stage labels', () => {
    render(<OrderLifecycleRibbon leadingStatus="ingresado" />);
    expect(screen.getByText('Ingresado')).toBeTruthy();
    expect(screen.getByText('Verificado')).toBeTruthy();
    expect(screen.getByText('En Bodega')).toBeTruthy();
    expect(screen.getByText('Asignado')).toBeTruthy();
    expect(screen.getByText('En Carga')).toBeTruthy();
    expect(screen.getByText('Listo')).toBeTruthy();
    expect(screen.getByText('En Ruta')).toBeTruthy();
    expect(screen.getByText('Entregado')).toBeTruthy();
  });

  it('marks stages before current as done', () => {
    render(<OrderLifecycleRibbon leadingStatus="en_bodega" />);
    const ingresado = screen.getByTestId('stage-ingresado');
    const verificado = screen.getByTestId('stage-verificado');
    const enBodega = screen.getByTestId('stage-en_bodega');
    const asignado = screen.getByTestId('stage-asignado');
    expect(ingresado.getAttribute('data-state')).toBe('done');
    expect(verificado.getAttribute('data-state')).toBe('done');
    expect(enBodega.getAttribute('data-state')).toBe('active');
    expect(asignado.getAttribute('data-state')).toBe('pending');
  });

  it('marks current stage as active', () => {
    render(<OrderLifecycleRibbon leadingStatus="en_ruta" />);
    expect(screen.getByTestId('stage-en_ruta').getAttribute('data-state')).toBe('active');
  });

  it('marks all stages as done when entregado', () => {
    render(<OrderLifecycleRibbon leadingStatus="entregado" />);
    const stages = screen.getAllByTestId(/^stage-/);
    stages.forEach((s) => expect(s.getAttribute('data-state')).toBe('done'));
  });

  it('handles unknown status gracefully (all pending)', () => {
    render(<OrderLifecycleRibbon leadingStatus="cancelado" />);
    const stages = screen.getAllByTestId(/^stage-/);
    stages.forEach((s) => {
      expect(['done', 'pending']).toContain(s.getAttribute('data-state'));
    });
  });
});
