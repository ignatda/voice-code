const API_BASE = (import.meta.env.VITE_SOCKET_SERVER_URL || 'http://localhost:5000') + '/api/settings';

export async function loadEnv() {
  try {
    const res = await fetch(API_BASE);
    if (!res.ok) return {};
    const { settings } = await res.json();
    return settings || {};
  } catch {
    return {};
  }
}

export async function saveEnv(updates) {
  // Never send masked API key values
  const clean = { ...updates };
  for (const key of ['XAI_API_KEY', 'GEMINI_API_KEY', 'GROQ_API_KEY']) {
    if (clean[key] && clean[key].startsWith('••')) delete clean[key];
  }

  try {
    await fetch(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(clean),
    });
  } catch (e) {
    console.error('[settings] Save error:', e);
  }

  return loadEnv();
}

export async function needsSetup() {
  try {
    const res = await fetch(API_BASE + '/setup-required');
    if (!res.ok) return true;
    const { setupRequired } = await res.json();
    return setupRequired;
  } catch {
    return true;
  }
}
