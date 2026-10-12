'use client';

import * as React from 'react';
import { Moon, Sun } from 'lucide-react';
import { EiaButton, type EiaButtonProps } from './index';

export type EiaTheme = 'dark' | 'light';
export type EiaThemePreference = EiaTheme | 'system';
const STORAGE_KEY = 'empreende-ia-theme';
const CHANGE_EVENT = 'eia-theme-change';

function validTheme(value: string | null | undefined): EiaTheme {
  return value === 'light' ? 'light' : 'dark';
}

function validPreference(value: string | null | undefined): EiaThemePreference {
  return value === 'system' ? 'system' : validTheme(value);
}
function readStoredTheme(): EiaThemePreference {
  try {
    return validPreference(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return 'dark';
  }
}
function resolveTheme(preference: EiaThemePreference): EiaTheme {
  return preference === 'system'
    ? window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark'
    : preference;
}
function setDocumentTheme(preference: EiaThemePreference) {
  const theme = resolveTheme(preference);
  document.documentElement.dataset.eiaTheme = theme;
  document.documentElement.dataset.eiaThemePreference = preference;
  document.documentElement.style.colorScheme = theme;
}
/** Imperative equivalent for integrations outside a provider. */
export function applyEiaTheme(
  preference: EiaThemePreference,
  { persist = true }: { persist?: boolean } = {},
) {
  if (typeof document === 'undefined') return;
  setDocumentTheme(preference);
  if (persist) {
    try {
      window.localStorage.setItem(STORAGE_KEY, preference);
    } catch {
      /* Storage is optional. */
    }
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
const setTheme = applyEiaTheme;
function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    setDocumentTheme(
      event.key === null ? readStoredTheme() : validPreference(event.newValue),
    );
    onChange();
  };
  const media = window.matchMedia('(prefers-color-scheme: light)');
  const onSystem = () => {
    if (getPreferenceSnapshot() === 'system') {
      setDocumentTheme('system');
      onChange();
    }
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener('storage', onStorage);
  media.addEventListener('change', onSystem);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onStorage);
    media.removeEventListener('change', onSystem);
  };
}
function getPreferenceSnapshot(): EiaThemePreference {
  return validPreference(
    document.documentElement.dataset.eiaThemePreference ??
      document.documentElement.dataset.eiaTheme,
  );
}
function getSnapshot(): EiaTheme {
  return validTheme(document.documentElement.dataset.eiaTheme);
}

function getServerSnapshot(): EiaTheme {
  return 'dark';
}

export type EiaThemeContextValue = {
  theme: EiaTheme;
  preference: EiaThemePreference;
  setTheme: (theme: EiaThemePreference) => void;
  toggleTheme: () => void;
};

const ThemeContext = React.createContext<EiaThemeContextValue | null>(null);

export type EiaThemeProviderProps = { children: React.ReactNode };

/** Theme state follows the root HTML attribute, including portaled components. */
export function EiaThemeProvider({ children }: EiaThemeProviderProps) {
  const preference = React.useSyncExternalStore(
    subscribe,
    getPreferenceSnapshot,
    getServerSnapshot,
  );
  const theme = React.useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  React.useEffect(() => {
    if (!document.documentElement.dataset.eiaTheme) {
      setDocumentTheme(readStoredTheme());
      window.dispatchEvent(new Event(CHANGE_EVENT));
    }
  }, []);

  const value = React.useMemo<EiaThemeContextValue>(
    () => ({
      theme,
      preference,
      setTheme,
      toggleTheme: () => setTheme(getSnapshot() === 'dark' ? 'light' : 'dark'),
    }),
    [theme, preference],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useEiaTheme(): EiaThemeContextValue {
  const context = React.useContext(ThemeContext);
  // The document store remains authoritative across HMR and for standalone
  // controls. Hook order is stable whether a provider is present or not.
  const preference = React.useSyncExternalStore(
    subscribe,
    getPreferenceSnapshot,
    getServerSnapshot,
  );
  const theme = React.useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
  return React.useMemo(
    () =>
      context ?? {
        theme,
        preference,
        setTheme,
        toggleTheme: () =>
          setTheme(getSnapshot() === 'dark' ? 'light' : 'dark'),
      },
    [context, theme, preference],
  );
}

export type EiaThemeToggleProps = Omit<
  EiaButtonProps,
  'children' | 'onClick' | 'leadingIcon' | 'trailingIcon'
> & {
  /** Hide only the visible text; the accessible name always remains. */
  iconOnly?: boolean;
};

export function EiaThemeToggle({
  iconOnly = false,
  className = '',
  variant = 'secondary',
  size = 'sm',
  ...props
}: EiaThemeToggleProps) {
  const { theme, toggleTheme } = useEiaTheme();
  return (
    <EiaButton
      {...props}
      className={`eia-theme eia-theme-toggle ${iconOnly ? 'eia-theme-toggle-icon' : ''} ${className}`}
      variant={variant}
      size={size}
      onClick={toggleTheme}
      aria-label="Tema claro"
      aria-pressed={theme === 'light'}
      title={theme === 'light' ? 'Ativar tema escuro' : 'Ativar tema claro'}
      leadingIcon={
        <>
          <Sun className="eia-theme-sun" aria-hidden="true" />
          <Moon className="eia-theme-moon" aria-hidden="true" />
        </>
      }
    >
      {!iconOnly && (
        <>
          <span className="eia-theme-dark-label">Escuro</span>
          <span className="eia-theme-light-label">Claro</span>
        </>
      )}
    </EiaButton>
  );
}

export type EiaThemeScriptProps = { nonce?: string };

/** Render in <head> before the body, with suppressHydrationWarning on <html>. */
export function EiaThemeScript({ nonce }: EiaThemeScriptProps) {
  const script =
    "(function(){var p='dark';try{var v=localStorage.getItem('empreende-ia-theme');if(v==='light'||v==='system')p=v}catch(e){}var t=p==='system'?(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'):p;document.documentElement.dataset.eiaTheme=t;document.documentElement.dataset.eiaThemePreference=p;document.documentElement.style.colorScheme=t})()";
  return (
    <script
      nonce={nonce}
      data-eia-theme-init=""
      dangerouslySetInnerHTML={{ __html: script }}
    />
  );
}

export function EiaThemePreferenceControl() {
  const { preference, theme, setTheme } = useEiaTheme();
  return (
    <div className="eia-theme">
      <fieldset
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          border: 0,
          padding: 0,
          margin: 0,
          minWidth: 0,
        }}
        aria-label="Preferência de tema"
      >
        {(
          [
            { value: 'dark', label: 'Escuro' },
            { value: 'light', label: 'Claro' },
            { value: 'system', label: 'Sistema' },
          ] as const
        ).map((item) => (
          <EiaButton
            key={item.value}
            size="sm"
            variant={preference === item.value ? 'primary' : 'secondary'}
            aria-pressed={preference === item.value}
            onClick={() => setTheme(item.value)}
          >
            {item.label}
          </EiaButton>
        ))}
      </fieldset>
      <p>
        Tema em uso: {theme === 'dark' ? 'escuro' : 'claro'}. O padrão sem
        preferência salva continua escuro.
      </p>
    </div>
  );
}
