import { useState, useMemo, useEffect } from 'react';
import { useSettings } from '../contexts/SettingsContext';
import { useNavigate } from 'react-router-dom';
import HelpTooltip from './HelpTooltip';

const PROVIDER_HELP = {
  XAI_API_KEY: {
    steps: ['Go to console.x.ai', 'Sign up or log in', 'Navigate to API Keys → Create new key', 'Free credits included with new accounts'],
    link: 'https://console.x.ai',
    linkText: 'console.x.ai',
  },
  GEMINI_API_KEY: {
    steps: ['Go to aistudio.google.com', 'Sign in with Google account', 'Click "Get API key" → Create key', 'Free tier: 15 requests/minute'],
    link: 'https://aistudio.google.com',
    linkText: 'aistudio.google.com',
  },
  GROQ_API_KEY: {
    steps: ['Go to console.groq.com', 'Sign up or log in', 'Navigate to API Keys → Create', 'Free tier: ~30 requests/minute'],
    link: 'https://console.groq.com',
    linkText: 'console.groq.com',
  },
};

export default function Settings() {
  const { settings, updateSettings, setupRequired } = useSettings();
  const navigate = useNavigate();
  const hasKeys = !!(settings.XAI_API_KEY || settings.GEMINI_API_KEY || settings.GROQ_API_KEY);

  const initial = useMemo(() => ({
    LLM_PROVIDERS: settings.LLM_PROVIDERS || 'xai',
    XAI_API_KEY: '',
    GEMINI_API_KEY: '',
    GROQ_API_KEY: '',
    STT_PROVIDER: settings.STT_PROVIDER || 'xai',
    PORT: settings.PORT || '5000',
    CODING_CLI: settings.CODING_CLI || 'opencode',
    IDE_TYPE: settings.IDE_TYPE || 'jetbrains',
    EXTENSIONS: settings.EXTENSIONS || 'none',
    SCHEDULED_TASKS: settings.SCHEDULED_TASKS || 'none',
  }), [settings]);

  const [form, setForm] = useState(initial);

  const handleSave = async (e) => {
    e.preventDefault();
    const updates = { ...form };
    // Don't send empty API key fields (keeps existing values)
    for (const key of ['XAI_API_KEY', 'GEMINI_API_KEY', 'GROQ_API_KEY']) {
      if (!updates[key]) delete updates[key];
    }
    await updateSettings(updates);
    if (hasKeys || form.XAI_API_KEY || form.GEMINI_API_KEY || form.GROQ_API_KEY) navigate('/');
  };

  const set = (key) => (e) => setForm(f => ({ ...f, [key]: e.target.value }));

  const goBack = () => { if (hasKeys) navigate('/'); };

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') goBack(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="settings-page">
      <form className="settings-form" onSubmit={handleSave}>
        <h2>Settings</h2>
        {setupRequired && <p className="settings-notice">Please configure required settings to continue.</p>}

        <label>
          LLM Providers <span className="required">*</span>
          <input type="text" value={form.LLM_PROVIDERS} onChange={set('LLM_PROVIDERS')} placeholder="xai,gemini,groq" required />
          <span className="settings-hint">Comma-separated, first = primary. Available: xai, gemini, groq</span>
        </label>

        <label>
          xAI API Key <HelpTooltip {...PROVIDER_HELP.XAI_API_KEY} />
          <input type="password" value={form.XAI_API_KEY} placeholder={settings.XAI_API_KEY || 'your-xai-api-key'} onChange={set('XAI_API_KEY')} />
        </label>

        <label>
          Gemini API Key <HelpTooltip {...PROVIDER_HELP.GEMINI_API_KEY} />
          <input type="password" value={form.GEMINI_API_KEY} placeholder={settings.GEMINI_API_KEY || 'your-gemini-api-key'} onChange={set('GEMINI_API_KEY')} />
        </label>

        <label>
          Groq API Key <HelpTooltip {...PROVIDER_HELP.GROQ_API_KEY} />
          <input type="password" value={form.GROQ_API_KEY} placeholder={settings.GROQ_API_KEY || 'your-groq-api-key'} onChange={set('GROQ_API_KEY')} />
        </label>

        <label>
          STT Provider
          <select value={form.STT_PROVIDER} onChange={set('STT_PROVIDER')}>
            <option value="xai">xAI Realtime (WebSocket, real-time)</option>
            <option value="groq">Groq Whisper (batch, free)</option>
          </select>
          <span className="settings-hint">xAI = real-time streaming, Groq = slight delay but free tier</span>
        </label>

        <label>
          Port
          <input type="text" value={form.PORT} onChange={set('PORT')} />
        </label>

        <label>
          Coding CLI
          <select value={form.CODING_CLI} onChange={set('CODING_CLI')}>
            <option value="opencode">opencode</option>
            <option value="kiro-cli">kiro-cli</option>
            <option value="none">none (agent codes directly)</option>
          </select>
        </label>

        <label>
          IDE Type
          <select value={form.IDE_TYPE} onChange={set('IDE_TYPE')}>
            <option value="jetbrains">JetBrains</option>
            <option value="vscode">VS Code</option>
            <option value="none">none (no IDE)</option>
          </select>
        </label>

        <label>
          Extensions
          <input type="text" value={form.EXTENSIONS} onChange={set('EXTENSIONS')} placeholder="none, example, or comma-separated names" />
        </label>

        <label>
          Scheduled Tasks
          <input type="text" value={form.SCHEDULED_TASKS} onChange={set('SCHEDULED_TASKS')} placeholder="none, or comma-separated task names" />
        </label>

        <div className="settings-actions">
          <button type="submit">Save</button>
          {!setupRequired && <button type="button" onClick={() => navigate('/')}>Cancel</button>}
        </div>
      </form>
    </div>
  );
}
