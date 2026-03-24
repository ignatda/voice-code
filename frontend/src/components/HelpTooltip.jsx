import { useState } from 'react';

export default function HelpTooltip({ steps, link, linkText }) {
  const [open, setOpen] = useState(false);

  return (
    <span className="help-tooltip-wrapper">
      <button type="button" className="help-tooltip-btn" onClick={() => setOpen(!open)} title="How to get this key">?</button>
      {open && (
        <div className="help-tooltip-popover">
          <ol>{steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
          {link && <a href={link} target="_blank" rel="noopener noreferrer">{linkText || link}</a>}
        </div>
      )}
    </span>
  );
}
