'use client';

import * as React from 'react';
import { Moon, Sun, Monitor } from 'lucide-react';
import { useTheme } from './theme-provider';

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  const [isOpen, setIsOpen] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className="w-9 h-9" />;
  }

  const themes = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'system', label: 'System', icon: Monitor },
  ] as const;

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        aria-label="Toggle theme"
      >
        {theme === 'light' && <Sun className="h-5 w-5" />}
        {theme === 'dark' && <Moon className="h-5 w-5" />}
        {theme === 'system' && <Monitor className="h-5 w-5" />}
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute right-0 mt-2 w-36 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-lg z-50">
            {themes.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                onClick={() => {
                  setTheme(value);
                  setIsOpen(false);
                }}
                className={`flex items-center gap-2 w-full px-3 py-2 text-sm font-light hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors ${
                  theme === value ? 'text-gray-900 dark:text-gray-100 bg-gray-100 dark:bg-gray-800' : 'text-gray-700 dark:text-gray-300'
                } ${value === 'light' ? 'rounded-t-lg' : value === 'system' ? 'rounded-b-lg' : ''}`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}