import { createContext, useState, useEffect, useContext } from 'react';
import { loadEnv, needsSetup } from '../config/env';

const SettingsContext = createContext();

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState({});
  const [setupRequired, setSetupRequired] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([loadEnv(), needsSetup()]).then(([env, setup]) => {
      setSettings(env);
      setSetupRequired(setup);
      setLoading(false);
    });
  }, []);

  const updateSettings = async (updates) => {
    const { saveEnv } = await import('../config/env');
    const merged = await saveEnv(updates);
    setSettings(merged);
    const setup = await needsSetup();
    setSetupRequired(setup);
  };

  return (
    <SettingsContext.Provider value={{ settings, updateSettings, setupRequired, loading }}>
      {children}
    </SettingsContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSettings() {
  return useContext(SettingsContext);
}
