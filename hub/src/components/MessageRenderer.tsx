/**
 * MessageRenderer — Sandboxed markdown renderer for session messages and
 * outcome page narrative.
 *
 * Wraps `react-markdown` with `rehype-highlight` (syntax highlighting in fenced
 * code blocks) + `remark-gfm` (tables, strikethrough, task lists). Raw HTML
 * inside markdown is REJECTED — `react-markdown` v10 strips it by default
 * unless `rehype-raw` is added, which we deliberately avoid.
 *
 * Allowed primitives: headings, paragraphs, lists, blockquotes, code (inline
 * + fenced), tables, horizontal rules, links (with rel="noopener noreferrer"
 * and target="_blank" applied by component override).
 *
 * Disallowed: <script>, <iframe>, <img onerror=...>, raw <a href="javascript:">,
 * style attributes — anything that could exfiltrate session content.
 */
import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';

interface MessageRendererProps {
  /** Raw markdown text. */
  content: string;
}

/**
 * Allow-list of element types that may appear in rendered output.
 * `react-markdown` will strip everything else with `disallowedElements`.
 */
const ALLOWED_ELEMENTS = [
  'p', 'em', 'strong', 'del', 'a', 'code', 'pre',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li',
  'blockquote', 'hr',
  'table', 'thead', 'tbody', 'tr', 'td', 'th',
  'br',
];

/**
 * Render markdown into the AgentBnB hub design system.
 *
 * The renderer is intentionally tight: only the primitives in
 * `ALLOWED_ELEMENTS` are emitted, links are forced to open safely, and code
 * blocks pick up `rehype-highlight` styling (loaded via highlight.js theme
 * CSS at the app entry — falls back to monospace if not present).
 */
function MessageRendererImpl({ content }: MessageRendererProps): JSX.Element {
  return (
    <div className="text-sm text-hub-text-primary leading-relaxed break-words [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        allowedElements={ALLOWED_ELEMENTS}
        unwrapDisallowed
        components={{
          a: ({ href, children, ...rest }) => (
            <a
              href={typeof href === 'string' && href.startsWith('javascript:') ? '#' : href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-hub-accent hover:underline"
              {...rest}
            >
              {children}
            </a>
          ),
          code: ({ className, children, ...rest }) => {
            const isBlock = typeof className === 'string' && className.startsWith('language-');
            if (isBlock) {
              return (
                <code
                  className={`${className ?? ''} font-mono text-[12px]`}
                  {...rest}
                >
                  {children}
                </code>
              );
            }
            return (
              <code
                className="font-mono text-[12px] px-1 py-0.5 rounded bg-white/[0.06] border border-hub-border-hairline"
                {...rest}
              >
                {children}
              </code>
            );
          },
          pre: ({ children, ...rest }) => (
            <pre
              className="my-3 overflow-x-auto rounded-lg border border-hub-border-default bg-hub-surface-0 px-3 py-2 text-[12px]"
              {...rest}
            >
              {children}
            </pre>
          ),
          p: ({ children, ...rest }) => (
            <p className="my-2" {...rest}>{children}</p>
          ),
          ul: ({ children, ...rest }) => (
            <ul className="my-2 list-disc list-inside space-y-1" {...rest}>{children}</ul>
          ),
          ol: ({ children, ...rest }) => (
            <ol className="my-2 list-decimal list-inside space-y-1" {...rest}>{children}</ol>
          ),
          h1: ({ children, ...rest }) => (
            <h1 className="my-3 text-base font-semibold text-hub-text-primary" {...rest}>{children}</h1>
          ),
          h2: ({ children, ...rest }) => (
            <h2 className="my-3 text-[15px] font-semibold text-hub-text-primary" {...rest}>{children}</h2>
          ),
          h3: ({ children, ...rest }) => (
            <h3 className="my-2 text-sm font-semibold text-hub-text-primary" {...rest}>{children}</h3>
          ),
          blockquote: ({ children, ...rest }) => (
            <blockquote
              className="my-3 border-l-2 border-hub-accent/40 pl-3 text-hub-text-secondary italic"
              {...rest}
            >
              {children}
            </blockquote>
          ),
          table: ({ children, ...rest }) => (
            <div className="my-3 overflow-x-auto">
              <table
                className="w-full border-collapse border border-hub-border-default rounded-md text-[12px]"
                {...rest}
              >
                {children}
              </table>
            </div>
          ),
          th: ({ children, ...rest }) => (
            <th
              className="border border-hub-border-default bg-white/[0.04] px-2 py-1 text-left font-semibold"
              {...rest}
            >
              {children}
            </th>
          ),
          td: ({ children, ...rest }) => (
            <td className="border border-hub-border-default px-2 py-1" {...rest}>{children}</td>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

/** Memoized markdown renderer — message lists re-render frequently. */
const MessageRenderer = memo(MessageRendererImpl);
export default MessageRenderer;
