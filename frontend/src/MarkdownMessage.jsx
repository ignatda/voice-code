import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

const components = {
  a({ href, children, ...props }) {
    return <a href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>;
  },
  code({ className, children, ...props }) {
    const match = /language-(\w+)/.exec(className || '');
    const code = String(children).replace(/\n$/, '');
    if (match) {
      return (
        <SyntaxHighlighter style={oneDark} language={match[1]} PreTag="div" customStyle={{ margin: '8px 0', borderRadius: '6px', fontSize: '13px' }}>
          {code}
        </SyntaxHighlighter>
      );
    }
    return <code className="inline-code" {...props}>{children}</code>;
  },
};

export default function MarkdownMessage({ text }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{text}</ReactMarkdown>
    </div>
  );
}
