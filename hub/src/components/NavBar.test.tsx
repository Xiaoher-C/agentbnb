/**
 * NavBar component tests.
 * Covers hamburger menu behavior on mobile and desktop responsive layout.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MemoryRouter } from 'react-router';
import NavBar from './NavBar.js';

const defaultProps: { apiKey: string | null; balance: number | null; onLogout: () => void } = {
  apiKey: null,
  balance: null,
  onLogout: () => {},
};

function renderNavBar(props = defaultProps) {
  return render(
    <MemoryRouter>
      <NavBar {...props} />
    </MemoryRouter>,
  );
}

describe('NavBar', () => {
  it('renders hamburger button with md:hidden class', () => {
    renderNavBar();
    const hamburger = screen.getByRole('button', { name: /toggle menu/i });
    expect(hamburger).toBeInTheDocument();
    // The button should carry the md:hidden class so it hides on desktop
    expect(hamburger.className).toMatch(/md:hidden/);
  });

  it('hamburger button toggles mobile menu open and closed', () => {
    renderNavBar();
    const hamburger = screen.getByRole('button', { name: /toggle menu/i });

    // Drawer should not exist yet
    expect(screen.queryByRole('navigation', { name: /mobile nav/i })).not.toBeInTheDocument();

    // Open
    fireEvent.click(hamburger);
    // After opening, mobile drawer nav should appear
    const mobileNav = screen.getByRole('navigation', { name: /mobile nav/i });
    expect(mobileNav).toBeInTheDocument();

    // Close
    fireEvent.click(hamburger);
    expect(screen.queryByRole('navigation', { name: /mobile nav/i })).not.toBeInTheDocument();
  });

  it('tab strip has hidden md:flex classes (desktop-only)', () => {
    renderNavBar();
    // The desktop tab nav should carry hidden and md:flex so it's desktop-only
    const desktopNav = screen.getByRole('navigation', { name: /desktop nav/i });
    expect(desktopNav).toBeInTheDocument();
    expect(desktopNav.className).toMatch(/hidden/);
    expect(desktopNav.className).toMatch(/md:flex/);
  });

  it('clicking a nav item in the mobile drawer closes the drawer', () => {
    renderNavBar();
    const hamburger = screen.getByRole('button', { name: /toggle menu/i });

    // Open drawer
    fireEvent.click(hamburger);
    expect(screen.getByRole('navigation', { name: /mobile nav/i })).toBeInTheDocument();

    // Click a link inside the drawer — "Discover" link (to="/")
    const discoverLinks = screen.getAllByRole('link', { name: /discover/i });
    // Click one of the Discover links (may be one in mobile drawer)
    fireEvent.click(discoverLinks[discoverLinks.length - 1]);

    // Drawer should close
    expect(screen.queryByRole('navigation', { name: /mobile nav/i })).not.toBeInTheDocument();
  });

  it('renders credit balance badge when authenticated', () => {
    renderNavBar({ ...defaultProps, apiKey: 'sk-test', balance: 42 });
    expect(screen.getByText(/cr 42/)).toBeInTheDocument();
  });

  it('shows an explicit sign-in link when unauthenticated', () => {
    renderNavBar();
    expect(screen.getByRole('link', { name: /sign in/i })).toBeInTheDocument();
  });

  it('does not expose the retired Hub Agents entry in the authenticated dropdown', () => {
    renderNavBar({ ...defaultProps, apiKey: 'sk-test', balance: 42 });
    fireEvent.click(screen.getByRole('button', { name: /my agent/i }));
    expect(screen.queryByRole('link', { name: /hub agents/i })).not.toBeInTheDocument();
  });

  it('does not expose the dead settings entry in the authenticated dropdown', () => {
    renderNavBar({ ...defaultProps, apiKey: 'sk-test', balance: 42 });
    fireEvent.click(screen.getByRole('button', { name: /my agent/i }));
    expect(screen.queryByRole('link', { name: /settings/i })).not.toBeInTheDocument();
  });

  it('uses position-fixed scroll lock when drawer is open (iOS-safe)', () => {
    renderNavBar();
    const hamburger = screen.getByRole('button', { name: /toggle menu/i });

    // Open drawer
    fireEvent.click(hamburger);
    expect(document.body.style.position).toBe('fixed');

    // Close drawer
    fireEvent.click(hamburger);
    expect(document.body.style.position).toBe('');
  });
});
