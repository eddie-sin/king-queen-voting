import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { readLanguage, translate, LANGUAGE_KEY } from './locale.js';
import './language.css';

const LanguageContext = createContext({ language: 'my', setLanguage: () => {} });

export function LanguageProvider({ children }) {
  const [language, updateLanguage] = useState(readLanguage);
  const setLanguage = useCallback(next => {
    if (!['my', 'en'].includes(next)) return;
    updateLanguage(next);
    try { localStorage.setItem(LANGUAGE_KEY, next); } catch { /* Private browsing still supports switching. */ }
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
    document.title = language === 'my' ? 'သီတင်းကျွတ် · GUSTO College' : 'Thadingyut · GUSTO College';
    window.dispatchEvent(new Event('festival-language-change'));
  }, [language]);
  useEffect(() => {
    const sync = event => {
      if (event.key === LANGUAGE_KEY || event.key === null) updateLanguage(readLanguage());
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  const value = useMemo(() => ({ language, setLanguage }), [language, setLanguage]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export const useLanguage = () => useContext(LanguageContext);

export function useT() {
  const { language } = useLanguage();
  return useCallback((text, values) => translate(text, language, values), [language]);
}
