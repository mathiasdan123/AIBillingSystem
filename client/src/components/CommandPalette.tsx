import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { useTranslation } from 'react-i18next';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import {
  topLevelItems,
  navigationSections,
  sectionLabelFallbacks,
  flattenNavItems,
  itemVisibleToUser,
} from '@/lib/nav-config';
import { useAuth } from '@/hooks/useAuth';

/**
 * Cmd+K command palette for jumping to any page. v1 covers pages from the
 * nav config (respecting role). Patient/claim search is a follow-up.
 *
 * Global hotkey: ⌘K (macOS) / Ctrl+K (others). Also "/" when no input is
 * focused. The palette manages its own open state; a small hook is also
 * exported (`useCommandPaletteTrigger`) for the trigger buttons elsewhere.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [, setLocation] = useLocation();
  const { t } = useTranslation();
  const { isAdmin } = useAuth();

  // Global hotkey
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isCmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k';
      if (isCmdK) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Listen for a custom event the trigger button dispatches, so any component
  // can open the palette without prop-drilling.
  useEffect(() => {
    const open = () => setOpen(true);
    window.addEventListener('command-palette:open', open);
    return () => window.removeEventListener('command-palette:open', open);
  }, []);

  const go = (href: string) => {
    setOpen(false);
    setLocation(href);
  };

  // Flatten top-level + section items into groups for the palette.
  const visibleTopLevel = topLevelItems.filter((i) => itemVisibleToUser(i, isAdmin));
  const groupedSections = navigationSections
    .map((section) => ({
      labelKey: section.labelKey,
      items: flattenNavItems(section.items, isAdmin),
    }))
    .filter((section) => section.items.length > 0);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder={t('commandPalette.search', 'Search pages…')} />
      <CommandList>
        <CommandEmpty>{t('commandPalette.noResults', 'No results found.')}</CommandEmpty>

        {visibleTopLevel.length > 0 && (
          <CommandGroup heading={t('commandPalette.pages', 'Pages')}>
            {visibleTopLevel.map((item) => {
              const Icon = item.icon;
              return (
                <CommandItem
                  key={item.nameKey}
                  value={`${t(item.nameKey)} ${item.href ?? ''}`}
                  onSelect={() => item.href && go(item.href)}
                >
                  <Icon className="mr-2 h-4 w-4" />
                  <span>{t(item.nameKey)}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}

        {groupedSections.map((section, idx) => (
          <div key={section.labelKey}>
            {(idx > 0 || visibleTopLevel.length > 0) && <CommandSeparator />}
            <CommandGroup
              heading={t(section.labelKey, sectionLabelFallbacks[section.labelKey] || section.labelKey)}
            >
              {section.items.map((item) => {
                const Icon = item.icon;
                return (
                  <CommandItem
                    key={item.nameKey}
                    value={`${t(item.nameKey)} ${item.href ?? ''}`}
                    onSelect={() => item.href && go(item.href)}
                  >
                    <Icon className="mr-2 h-4 w-4" />
                    <span>{t(item.nameKey)}</span>
                    {item.href && (
                      <span className="ml-auto text-xs text-muted-foreground">{item.href}</span>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </div>
        ))}
      </CommandList>
    </CommandDialog>
  );
}

/**
 * Dispatches a window event that the mounted <CommandPalette /> listens for.
 * Use from any trigger button:
 *   <Button onClick={openCommandPalette}>Search…</Button>
 */
export function openCommandPalette() {
  window.dispatchEvent(new Event('command-palette:open'));
}
