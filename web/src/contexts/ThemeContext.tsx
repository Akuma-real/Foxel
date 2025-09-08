import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ConfigProvider, theme as antdTheme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import type { ThemeConfig } from 'antd/es/config-provider/context';
import { getAllConfig } from '../api/config';
import { useAuth } from './AuthContext';
import baseTheme from '../theme';

type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeState {
  mode: ThemeMode;
  primaryColor?: string | null;
  borderRadius?: number | null;
  customTokens?: Record<string, any> | null;
  customCSS?: string | null;
}

interface ThemeContextType {
  refreshTheme: () => Promise<void>;
  previewTheme: (patch: Partial<ThemeState>) => void;
  mode: ThemeMode;
  resolvedMode: ThemeMode;
}

const Ctx = createContext<ThemeContextType>({} as any);

const CONFIG_KEYS = {
  MODE: 'THEME_MODE',
  PRIMARY: 'THEME_PRIMARY_COLOR',
  RADIUS: 'THEME_BORDER_RADIUS',
  TOKENS: 'THEME_CUSTOM_TOKENS',
  CSS: 'THEME_CUSTOM_CSS',
};

function parseJSON<T = any>(text: string | null | undefined): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function useSystemDarkPreferred() {
  const [isDark, setIsDark] = useState<boolean>(
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : false
  );
  useEffect(() => {
    if (!window.matchMedia) return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setIsDark(e.matches);
    mql.addEventListener?.('change', handler);
    return () => mql.removeEventListener?.('change', handler);
  }, []);
  return isDark;
}

function buildThemeConfig(state: ThemeState, systemDark: boolean): ThemeConfig {
  const resolvedMode: ThemeMode = state.mode === 'system' ? (systemDark ? 'dark' : 'light') : state.mode;
  const algorithm = resolvedMode === 'dark'
    ? [antdTheme.darkAlgorithm, antdTheme.compactAlgorithm]
    : [antdTheme.defaultAlgorithm, antdTheme.compactAlgorithm];

  const safeBaseTokens: Record<string, any> = resolvedMode === 'dark'
    ? {
        borderRadius: baseTheme.token?.borderRadius,
        fontSize: baseTheme.token?.fontSize,
        controlHeight: baseTheme.token?.controlHeight,
        boxShadow: baseTheme.token?.boxShadow,
      }
    : { ...(baseTheme.token as any) };

  const token = {
    ...safeBaseTokens,
    ...(state.primaryColor ? { colorPrimary: state.primaryColor } : {}),
    ...(state.borderRadius != null ? { borderRadius: state.borderRadius } : {}),
    ...(state.customTokens || {}),
  } as any;

  const baseComponents = { ...(baseTheme.components as any) };
  if (resolvedMode === 'dark' && baseComponents) {
    if (baseComponents.Menu) {
      const { itemHoverColor, itemHoverBg, itemSelectedBg, itemSelectedColor, ...rest } = baseComponents.Menu;
      baseComponents.Menu = rest;
    }
    if (baseComponents.Dropdown) {
      const { controlItemBgHover, ...rest } = baseComponents.Dropdown;
      baseComponents.Dropdown = rest;
    }
    if (baseComponents.Table) {
      const { headerBg, rowHoverBg, ...rest } = baseComponents.Table;
      baseComponents.Table = rest;
    }
  }

  return { algorithm, token, components: baseComponents } satisfies ThemeConfig;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  const systemDark = useSystemDarkPreferred();
  const [state, setState] = useState<ThemeState>({ mode: 'light' });
  const styleTagRef = useRef<HTMLStyleElement | null>(null);

  const ensureStyleTag = () => {
    if (styleTagRef.current) return styleTagRef.current;
    let styleEl = document.getElementById('foxel-custom-css') as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'foxel-custom-css';
      document.head.appendChild(styleEl);
    }
    styleTagRef.current = styleEl;
    return styleEl;
  };

  const applyCustomCSS = (cssText: string | null | undefined) => {
    const el = ensureStyleTag();
    el.textContent = cssText || '';
  };

  const applyHtmlDataTheme = (mode: ThemeMode) => {
    const finalMode = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode;
    document.documentElement.setAttribute('data-theme', finalMode);
  };

  const refreshTheme = async () => {
    if (!isAuthenticated) {
      applyHtmlDataTheme(state.mode || 'light');
      applyCustomCSS(state.customCSS || '');
      return;
    }
    try {
      const cfg = await getAllConfig();
      const mode = (cfg[CONFIG_KEYS.MODE] as ThemeMode) || 'light';
      const primary = (cfg[CONFIG_KEYS.PRIMARY] as string) || null;
      const radiusStr = cfg[CONFIG_KEYS.RADIUS];
      const radius = radiusStr != null ? Number(radiusStr) : null;
      const customTokens = parseJSON<Record<string, any>>(cfg[CONFIG_KEYS.TOKENS]);
      const customCSS = (cfg[CONFIG_KEYS.CSS] as string) || '';
      setState({ mode, primaryColor: primary, borderRadius: radius, customTokens, customCSS });
      applyHtmlDataTheme(mode);
      applyCustomCSS(customCSS);
    } catch (e) {
      applyHtmlDataTheme('light');
      applyCustomCSS('');
    }
  };

  const previewTheme = (patch: Partial<ThemeState>) => {
    const next: ThemeState = { ...state, ...patch };
    setState(next);
    applyHtmlDataTheme(next.mode || 'light');
    applyCustomCSS(next.customCSS || '');
  };

  useEffect(() => {
    refreshTheme();
  }, [isAuthenticated, systemDark]);

  const themeConfig = useMemo(() => buildThemeConfig(state, systemDark), [state, systemDark]);
  const resolvedMode: ThemeMode = useMemo(() => (state.mode === 'system' ? (systemDark ? 'dark' : 'light') : state.mode), [state.mode, systemDark]);

  const ctxValue = useMemo<ThemeContextType>(() => ({
    refreshTheme,
    previewTheme,
    mode: state.mode,
    resolvedMode,
  }), [state.mode, resolvedMode]);

  return (
    <Ctx.Provider value={ctxValue}>
      <ConfigProvider theme={{ ...themeConfig, cssVar: true }} locale={zhCN}>
        {children}
      </ConfigProvider>
    </Ctx.Provider>
  );
}

export function useTheme() {
  return useContext(Ctx);
}
