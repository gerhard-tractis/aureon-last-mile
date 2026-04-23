import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { ModelSelector } from './ModelSelector';
import { WISMO_TEST_MODELS } from '@/lib/dev/wismo-models';

describe('ModelSelector', () => {
  it('renders all 8 model options', () => {
    render(<ModelSelector value={WISMO_TEST_MODELS[0].id} onChange={vi.fn()} />);
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(WISMO_TEST_MODELS.length);
    // Verify each model ID is rendered as an option value
    WISMO_TEST_MODELS.forEach((m) => {
      const option = options.find((o) => (o as HTMLOptionElement).value === m.id);
      expect(option).toBeDefined();
    });
  });

  it('calls onChange when selection changes', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ModelSelector value={WISMO_TEST_MODELS[0].id} onChange={onChange} />);

    const select = screen.getByRole('combobox');
    await user.selectOptions(select, WISMO_TEST_MODELS[1].id);

    expect(onChange).toHaveBeenCalledWith(WISMO_TEST_MODELS[1].id);
  });

  it('reflects the current value', () => {
    render(<ModelSelector value={WISMO_TEST_MODELS[2].id} onChange={vi.fn()} />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe(WISMO_TEST_MODELS[2].id);
  });
});
