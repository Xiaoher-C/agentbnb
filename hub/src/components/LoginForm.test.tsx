/**
 * LoginForm component tests.
 * Covers API key input field and form submit behavior.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import LoginForm from './LoginForm.js';

describe('LoginForm', () => {
  it('has an input field for API key', () => {
    render(<LoginForm onLogin={() => {}} />);
    const input = screen.getByPlaceholderText('Paste your API key');
    expect(input).toBeInTheDocument();
  });

  it('has a submit button labeled Connect', () => {
    render(<LoginForm onLogin={() => {}} />);
    expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument();
  });

  it('calls onLogin with the entered key on submit', () => {
    const onLogin = vi.fn();
    render(<LoginForm onLogin={onLogin} />);
    const input = screen.getByPlaceholderText('Paste your API key');
    fireEvent.change(input, { target: { value: 'my-secret-key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(onLogin).toHaveBeenCalledWith('my-secret-key');
  });

  it('does not call onLogin when key is empty', () => {
    const onLogin = vi.fn();
    render(<LoginForm onLogin={onLogin} />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(onLogin).not.toHaveBeenCalled();
  });
});
