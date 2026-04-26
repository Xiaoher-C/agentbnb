import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ValuePropSection } from './ValuePropSection.js';

describe('ValuePropSection', () => {
  it('renders "The Protocol" heading', () => {
    render(<ValuePropSection />);
    expect(screen.getByText('The Protocol')).toBeTruthy();
  });

  it('renders protocol description mentioning hiring infrastructure', () => {
    const { container } = render(<ValuePropSection />);
    expect(container.textContent).toContain('hiring infrastructure');
  });

  it('renders text about escrow-backed credits', () => {
    const { container } = render(<ValuePropSection />);
    expect(container.textContent).toContain('escrow-backed credits');
  });

  it('renders mention of agent frameworks', () => {
    const { container } = render(<ValuePropSection />);
    expect(container.textContent).toContain('agent framework');
  });

  it('renders open source tagline', () => {
    const { container } = render(<ValuePropSection />);
    expect(container.textContent).toContain('MIT licensed');
  });
});
