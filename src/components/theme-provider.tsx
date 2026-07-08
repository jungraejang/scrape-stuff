"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type ThemeView = "normal" | "8bit";

const STORAGE_KEY = "theme-view";

type ThemeContextValue = {
  theme: ThemeView;
  setTheme: (theme: ThemeView) => void;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStoredTheme(): ThemeView {
  if (typeof window === "undefined") return "normal";
  return localStorage.getItem(STORAGE_KEY) === "8bit" ? "8bit" : "normal";
}

function applyThemeClass(theme: ThemeView) {
  document.documentElement.classList.toggle("theme-8bit", theme === "8bit");
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeView>("normal");

  useEffect(() => {
    const stored = readStoredTheme();
    setThemeState(stored);
    applyThemeClass(stored);
  }, []);

  const setTheme = useCallback((next: ThemeView) => {
    setThemeState(next);
    applyThemeClass(next);
    localStorage.setItem(STORAGE_KEY, next);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((current) => {
      const next: ThemeView = current === "8bit" ? "normal" : "8bit";
      applyThemeClass(next);
      localStorage.setItem(STORAGE_KEY, next);
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return ctx;
}
