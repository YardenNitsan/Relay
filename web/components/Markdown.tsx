import { memo } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';

const Markdown = memo(function Markdown({ content }: { content: string }) {
  return <div className="markdown" dir="auto"><ReactMarkdown skipHtml urlTransform={url => /^(?:https?:|mailto:)/i.test(url) ? defaultUrlTransform(url) : ''} components={{
    img: () => <span className="muted">[External image omitted]</span>,
    a: ({ children, href }) => href ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
    h1: ({ children }) => <h3 dir="auto">{children}</h3>,
    h2: ({ children }) => <h3 dir="auto">{children}</h3>,
    p: ({children})=><p dir="auto">{children}</p>,
    li: ({children})=><li dir="auto">{children}</li>,
    code: ({children,className})=><code dir="ltr" className={className}>{children}</code>,
    pre: ({children})=><pre dir="ltr" tabIndex={0} role="region" aria-label="Code block">{children}</pre>,
  }}>{content}</ReactMarkdown></div>;
});
export default Markdown;
