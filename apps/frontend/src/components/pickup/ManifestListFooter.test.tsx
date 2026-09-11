import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { ManifestListFooter } from './ManifestListFooter';

describe('ManifestListFooter', () => {
  it('renders nothing when the tab is empty', () => {
    const { container } = render(
      <ManifestListFooter shownCount={0} totalCount={0} onLoadMore={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the count and hides "Cargar más" once everything is shown', () => {
    render(<ManifestListFooter shownCount={5} totalCount={5} onLoadMore={vi.fn()} />);
    expect(screen.getByText('Mostrando 5 de 5')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cargar más' })).toBeNull();
  });

  it('fires onLoadMore when clicked', async () => {
    const onLoadMore = vi.fn();
    render(<ManifestListFooter shownCount={7} totalCount={12} onLoadMore={onLoadMore} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cargar más' }));
    expect(onLoadMore).toHaveBeenCalled();
  });
});
