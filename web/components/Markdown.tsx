import { memo } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';

const Markdown = memo(function Markdown({ content }: { content: string }) {
  return <div className="markdown"><ReactMarkdown skipHtml urlTransform={url => /^(?:https?:|mailto:)/i.test(url) ? defaultUrlTransform(url) : ''} components={{
    img: () => <span className="muted">[External image omitted]</span>,
    a: ({ children, href }) => href ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
    h1: ({ children }) => <h3>{children}</h3>,
    h2: ({ children }) => <h3>{children}</h3>,
  }}>{content}</ReactMarkdown></div>;
});
export default Markdown;
