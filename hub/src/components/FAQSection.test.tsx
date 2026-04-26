import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { FAQSection } from './FAQSection.js';

describe('FAQSection', () => {
  it('renders "FAQ" heading', () => {
    render(<FAQSection />);
    expect(screen.getByText('FAQ')).toBeTruthy();
  });

  it('renders "What is AgentBnB?" question', () => {
    render(<FAQSection />);
    expect(screen.getByText('What is AgentBnB?')).toBeTruthy();
  });

  it('renders "How do credits work?" question', () => {
    render(<FAQSection />);
    expect(screen.getByText('How do credits work?')).toBeTruthy();
  });

  it('renders "How do I list my agent\'s skills?" question', () => {
    render(<FAQSection />);
    expect(screen.getByText("How do I list my agent's skills?")).toBeTruthy();
  });

  it('renders "Which AI frameworks are supported?" question', () => {
    render(<FAQSection />);
    expect(screen.getByText('Which AI frameworks are supported?')).toBeTruthy();
  });

  it('renders "Is it open source?" question', () => {
    render(<FAQSection />);
    expect(screen.getByText('Is it open source?')).toBeTruthy();
  });

  it('renders "How do agents discover each other?" question', () => {
    render(<FAQSection />);
    expect(screen.getByText('How do agents discover each other?')).toBeTruthy();
  });

  it('renders at least 5 accordion items', () => {
    const { container } = render(<FAQSection />);
    const items = container.querySelectorAll('[data-slot="accordion-item"]');
    expect(items.length).toBeGreaterThanOrEqual(5);
  });

  it('has answer content for "What is AgentBnB?" after opening the item', () => {
    render(<FAQSection />);
    const trigger = screen.getByText('What is AgentBnB?');
    fireEvent.click(trigger);
    expect(screen.getByText(/hiring infrastructure/)).toBeTruthy();
  });

  it('has answer content for "How do credits work?" after opening the item', () => {
    render(<FAQSection />);
    const trigger = screen.getByText('How do credits work?');
    fireEvent.click(trigger);
    expect(screen.getByText(/coordination unit/)).toBeTruthy();
  });

  it('has answer content for open source after opening the item', () => {
    render(<FAQSection />);
    const trigger = screen.getByText('Is it open source?');
    fireEvent.click(trigger);
    expect(screen.getByText(/MIT licensed/)).toBeTruthy();
  });

  it('renders 6 accordion items total', () => {
    const { container } = render(<FAQSection />);
    const items = container.querySelectorAll('[data-slot="accordion-item"]');
    expect(items.length).toBe(6);
  });
});
