import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Chapter } from './Chapter';
import { ChapterHeroBand } from './ChapterHeroBand';
import { ChapterPlaceholder } from './ChapterPlaceholder';

describe('Chapter', () => {
  it('renders headline text', () => {
    render(
      <Chapter headline="CPO">
        <div>content</div>
      </Chapter>,
    );
    expect(screen.getByText('CPO')).toBeInTheDocument();
  });

  it('headline has italic class', () => {
    render(
      <Chapter headline="OTIF">
        <span />
      </Chapter>,
    );
    const headline = screen.getByText('OTIF');
    expect(headline.className).toMatch(/italic/);
  });

  it('renders children', () => {
    render(
      <Chapter headline="NPS">
        <span data-testid="child">child content</span>
      </Chapter>,
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });
});

describe('ChapterHeroBand', () => {
  it('renders the hero value string', () => {
    render(
      <ChapterHeroBand value="94,2%" momDelta={1.4} yoyDelta={-2.1} />,
    );
    expect(screen.getByText('94,2%')).toBeInTheDocument();
  });

  it('renders MoM delta via DeltaPill (▲)', () => {
    render(
      <ChapterHeroBand value="94,2%" momDelta={1.4} yoyDelta={null} />,
    );
    expect(screen.getByText(/▲/)).toBeInTheDocument();
  });

  it('renders YoY delta via DeltaPill (▼)', () => {
    render(
      <ChapterHeroBand value="94,2%" momDelta={null} yoyDelta={-2.1} />,
    );
    expect(screen.getByText(/▼/)).toBeInTheDocument();
  });

  it('has border-l-4 class on the wrapper', () => {
    const { container } = render(
      <ChapterHeroBand value="94,2%" momDelta={null} yoyDelta={null} />,
    );
    const el = container.firstChild as HTMLElement;
    expect(el.className).toMatch(/border-l-4/);
  });

  it('renders optional meta text', () => {
    render(
      <ChapterHeroBand value="94,2%" momDelta={null} yoyDelta={null} meta="meta 95%" />,
    );
    expect(screen.getByText('meta 95%')).toBeInTheDocument();
  });
});

describe('ChapterPlaceholder', () => {
  it('renders — as the hero value', () => {
    render(<ChapterPlaceholder reason="Requiere modelo de costos" />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders reason text', () => {
    render(<ChapterPlaceholder reason="Requiere modelo de costos" />);
    expect(screen.getByText('Requiere modelo de costos')).toBeInTheDocument();
  });

  it('renders children when provided', () => {
    render(
      <ChapterPlaceholder reason="Requiere feedback">
        <span data-testid="extra">extra content</span>
      </ChapterPlaceholder>,
    );
    expect(screen.getByTestId('extra')).toBeInTheDocument();
  });
});
