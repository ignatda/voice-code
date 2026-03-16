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
  if (clean.OPENAI_API_KEY && clean.OPENAI_API_KEY.startsWith('••')) delete clean.OPENAI_API_KEY;

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
