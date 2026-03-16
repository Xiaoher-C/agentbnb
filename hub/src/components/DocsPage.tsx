/**
 * DocsPage — Documentation page with sidebar navigation and content area.
 *
 * Shows 4 sections: Getting Started, Install, Card Schema, API Reference.
 * All content is static TypeScript JSX — no network requests.
 *
 * Layout:
 *  - Desktop: sticky sidebar (w-48) + scrollable content area
 *  - Mobile: horizontal-scroll tab strip at top + content below
 */
import { useState } from 'react';
import { DOCS_SECTIONS } from '../lib/docs-content.js';

/**
 * Renders the embedded documentation page with sidebar navigation.
 */
export default function DocsPage(): JSX.Element {
  const [activeSection, setActiveSection] = useState<string>('getting-started');

  const activeContent = DOCS_SECTIONS.find((s) => s.id === activeSection)?.content ?? null;

  return (
    <div className="flex flex-col md:flex-row gap-0 min-h-[calc(100vh-4rem)]">
      {/* ------------------------------------------------------------------ */}
      {/* Sidebar — desktop (sticky left column)                              */}
      {/* ------------------------------------------------------------------ */}
      <nav className="hidden md:flex flex-col w-48 shrink-0 pt-8 pr-4 sticky top-16 self-start">
        <p className="text-xs font-semibold text-hub-text-muted uppercase tracking-wider mb-4 px-3">
          Documentation
        </p>
        {DOCS_SECTIONS.map((section) => {
          const isActive = section.id === activeSection;
          return (
            <button
              key={section.id}
              onClick={() => {
                setActiveSection(section.id);
              }}
              className={`text-left px-3 py-2 rounded-md text-sm transition-colors mb-0.5 ${
                isActive
                  ? 'text-emerald-400 border-l-2 border-emerald-400 pl-[10px] bg-emerald-500/10'
                  : 'text-hub-text-muted hover:text-hub-text-primary hover:bg-white/[0.04]'
              }`}
            >
              {section.title}
            </button>
          );
        })}
      </nav>

      {/* ------------------------------------------------------------------ */}
      {/* Tab strip — mobile (horizontal scroll)                              */}
      {/* ------------------------------------------------------------------ */}
      <nav className="flex md:hidden flex-row overflow-x-auto gap-1 py-3 px-4 border-b border-white/[0.06] shrink-0">
        {DOCS_SECTIONS.map((section) => {
          const isActive = section.id === activeSection;
          return (
            <button
              key={section.id}
              onClick={() => {
                setActiveSection(section.id);
              }}
              className={`whitespace-nowrap px-3 py-1.5 rounded-md text-sm font-medium transition-colors shrink-0 ${
                isActive
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : 'text-hub-text-muted hover:text-hub-text-primary'
              }`}
            >
              {section.title}
            </button>
          );
        })}
      </nav>

      {/* ------------------------------------------------------------------ */}
      {/* Content area                                                         */}
      {/* ------------------------------------------------------------------ */}
      <main className="flex-1 min-w-0 py-8 px-4 md:px-8 max-w-3xl">{activeContent}</main>
    </div>
  );
}
