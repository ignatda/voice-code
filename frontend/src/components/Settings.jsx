import { useState, useMemo } from 'react';
import { useSettings } from '../contexts/SettingsContext';
import { useNavigate } from 'react-router-dom';

export default function Settings() {
  const { settings, updateSettings, setupRequired } = useSettings();
  const navigate = useNavigate();
  const hasApiKey = !!(settings.OPENAI_API_KEY);

  const initial = useMemo(() => ({
    OPENAI_API_KEY: '',
    OPENAI_BASE_URL: settings.OPENAI_BASE_URL || 'https://api.x.ai/v1',
    PORT: settings.PORT || '5000',
    CODING_CLI: settings.CODING_CLI || 'opencode',
    IDE_TYPE: settings.IDE_TYPE || 'jetbrains',
  }), [settings]);

  const [form, setForm] = useState(initial);

  const handleSave = async (e) => {
    e.preventDefault();
    const updates = { ...form };
    if (!updates.OPENAI_API_KEY) delete updates.OPENAI_API_KEY;
    await updateSettings(updates);
    if ((form.OPENAI_API_KEY || hasApiKey)) navigate('/');
  };

  const set = (key) => (e) => setForm(f => ({ ...f, [key]: e.target.value }));

  return (
    <div className="settings-page">
      <form className="settings-form" onSubmit={handleSave}>
        <h2>Settings</h2>
        {setupRequired && <p className="settings-notice">Please configure required settings to continue.</p>}

        <label>
          API Key <span className="required">*</span>
          <input type="password" value={form.OPENAI_API_KEY} placeholder={hasApiKey ? settings.OPENAI_API_KEY : 'your-xai-api-key-here'} onChange={set('OPENAI_API_KEY')} required={!hasApiKey} />
        </label>

        <label>
          Base URL
          <input type="text" value={form.OPENAI_BASE_URL} onChange={set('OPENAI_BASE_URL')} />
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

        <div className="settings-actions">
          <button type="submit">Save</button>
          {!setupRequired && <button type="button" onClick={() => navigate('/')}>Cancel</button>}
        </div>
      </form>
    </div>
  );
}
