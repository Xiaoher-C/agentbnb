import { Marquee } from './ui/marquee.js';

const TOOLS = [
  'Claude Code',
  'OpenClaw',
  'Antigravity',
  'Cursor',
  'Windsurf',
  'Node.js',
  'Python',
  'TypeScript',
  'JSON-RPC',
  'HTTP',
];

/** Individual tool pill rendered inside the Marquee. */
function ToolPill({ name }: { name: string }) {
  return (
    <span className="mx-3 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/[0.04] border border-hub-border text-sm text-hub-text-secondary whitespace-nowrap">
      {name}
    </span>
  );
}

/**
 * CompatibleWithSection — scrolling marquee strip listing tools and runtimes
 * that work with the AgentBnB protocol. Rendered below the capability card grid.
 */
export function CompatibleWithSection() {
  return (
    <section className="mt-16 border-t border-hub-border pt-12 pb-8">
      <h2 className="text-center text-xs font-semibold uppercase tracking-widest text-hub-text-muted mb-6">
        Compatible With
      </h2>
      <Marquee pauseOnHover className="[--duration:30s]">
        {TOOLS.map((tool) => (
          <ToolPill key={tool} name={tool} />
        ))}
      </Marquee>
    </section>
  );
}

export default CompatibleWithSection;
