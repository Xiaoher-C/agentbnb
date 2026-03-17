import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { CompatibleWithSection } from './CompatibleWithSection.js';

describe('CompatibleWithSection', () => {
  it('renders "Compatible With" heading', () => {
    render(<CompatibleWithSection />);
    expect(screen.getByText('Compatible With')).toBeTruthy();
  });

  it('renders Claude Code tool name', () => {
    render(<CompatibleWithSection />);
    expect(screen.getAllByText('Claude Code').length).toBeGreaterThan(0);
  });

  it('renders OpenClaw tool name', () => {
    render(<CompatibleWithSection />);
    expect(screen.getAllByText('OpenClaw').length).toBeGreaterThan(0);
  });

  it('renders Antigravity tool name', () => {
    render(<CompatibleWithSection />);
    expect(screen.getAllByText('Antigravity').length).toBeGreaterThan(0);
  });

  it('renders Cursor tool name', () => {
    render(<CompatibleWithSection />);
    expect(screen.getAllByText('Cursor').length).toBeGreaterThan(0);
  });

  it('renders Windsurf tool name', () => {
    render(<CompatibleWithSection />);
    expect(screen.getAllByText('Windsurf').length).toBeGreaterThan(0);
  });

  it('renders Node.js tool name', () => {
    render(<CompatibleWithSection />);
    expect(screen.getAllByText('Node.js').length).toBeGreaterThan(0);
  });

  it('renders Python tool name', () => {
    render(<CompatibleWithSection />);
    expect(screen.getAllByText('Python').length).toBeGreaterThan(0);
  });

  it('renders TypeScript tool name', () => {
    render(<CompatibleWithSection />);
    expect(screen.getAllByText('TypeScript').length).toBeGreaterThan(0);
  });

  it('renders JSON-RPC tool name', () => {
    render(<CompatibleWithSection />);
    expect(screen.getAllByText('JSON-RPC').length).toBeGreaterThan(0);
  });

  it('renders HTTP tool name', () => {
    render(<CompatibleWithSection />);
    expect(screen.getAllByText('HTTP').length).toBeGreaterThan(0);
  });

  it('renders at least 10 tool names', () => {
    const { container } = render(<CompatibleWithSection />);
    // Tool pills appear multiple times due to marquee repeat, just check content is present
    const tools = ['Claude Code', 'OpenClaw', 'Antigravity', 'Cursor', 'Windsurf', 'Node.js', 'Python', 'TypeScript', 'JSON-RPC', 'HTTP'];
    tools.forEach((tool) => {
      expect(container.textContent).toContain(tool);
    });
  });
});
