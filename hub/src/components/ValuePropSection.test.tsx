import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ValuePropSection } from './ValuePropSection.js';

describe('ValuePropSection', () => {
  it('renders "The Protocol" heading', () => {
    render(<ValuePropSection />);
    expect(screen.getByText('The Protocol')).toBeTruthy();
  });

  it('renders a paragraph containing "peer-to-peer"', () => {
    const { container } = render(<ValuePropSection />);
    expect(container.textContent).toContain('peer-to-peer');
  });

  it('renders protocol description mentioning JSON-RPC', () => {
    const { container } = render(<ValuePropSection />);
    expect(container.textContent).toContain('JSON-RPC');
  });

  it('renders text about agents sharing capabilities', () => {
    const { container } = render(<ValuePropSection />);
    expect(container.textContent).toContain('share idle capabilities');
  });

  it('renders open source tagline', () => {
    const { container } = render(<ValuePropSection />);
    expect(container.textContent).toContain('MIT licensed');
  });
});
