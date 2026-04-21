import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { HelpCircle, Search, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { helpSections, filterHelpSections, type HelpItem } from '@/lib/help-content';

/**
 * In-app Help sidebar.
 *
 * Renders a small ? icon button; clicking it opens a right-side slide-out
 * panel with searchable FAQ content. Content lives in @/lib/help-content
 * and is edited there, not here.
 *
 * Designed so sales/CS + end users can both use it — same source of truth
 * as the external Notion/Google Doc FAQ.
 */
export default function HelpSidebar() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(['getting-started'])
  );

  const filtered = useMemo(() => filterHelpSections(helpSections, query), [query]);

  // When a search is active, auto-expand matching sections so results are visible.
  const effectiveExpanded = useMemo(() => {
    if (!query.trim()) return expandedSections;
    return new Set(filtered.map((s) => s.id));
  }, [query, filtered, expandedSections]);

  const toggleSection = (id: string) => {
    if (query.trim()) return; // while searching, sections are auto-driven
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const totalResults = filtered.reduce((sum, s) => sum + s.items.length, 0);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          aria-label={t('nav.help')}
          title={t('nav.help')}
          data-testid="button-help-sidebar"
        >
          <HelpCircle className="w-3.5 h-3.5" aria-hidden="true" />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{t('help.title')}</SheetTitle>
          <SheetDescription>{t('help.description')}</SheetDescription>
        </SheetHeader>

        <div className="relative mt-4">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            placeholder={t('help.searchPlaceholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
            data-testid="input-help-search"
          />
        </div>

        {query.trim() && (
          <p className="mt-2 text-xs text-muted-foreground">
            {totalResults === 0
              ? t('help.noResults')
              : t('help.resultCount', { count: totalResults })}
          </p>
        )}

        <div className="mt-4 space-y-2">
          {filtered.map((section) => {
            const isExpanded = effectiveExpanded.has(section.id);
            return (
              <div key={section.id} className="border rounded-lg overflow-hidden">
                <button
                  type="button"
                  className="w-full flex items-center justify-between p-3 hover:bg-muted/50 text-left"
                  onClick={() => toggleSection(section.id)}
                  aria-expanded={isExpanded}
                  data-testid={`button-help-section-${section.id}`}
                >
                  <span className="font-medium text-sm">{section.title}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {section.items.length}
                    </span>
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    )}
                  </div>
                </button>
                {isExpanded && (
                  <div className="border-t divide-y">
                    {section.items.map((item, i) => (
                      <HelpItemRow key={i} item={item} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-6 pt-4 border-t text-xs text-muted-foreground">
          <p>{t('help.stillStuck')}</p>
          <p className="mt-1">
            <a
              href="mailto:support@therapybillai.com"
              className="underline hover:text-foreground"
            >
              support@therapybillai.com
            </a>
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function HelpItemRow({ item }: { item: HelpItem }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="p-3">
      <button
        type="button"
        className="w-full text-left flex items-start gap-2"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <ChevronRight
          className={`w-4 h-4 mt-0.5 text-muted-foreground flex-shrink-0 transition-transform ${
            expanded ? 'rotate-90' : ''
          }`}
          aria-hidden="true"
        />
        <span className="text-sm font-medium">{item.question}</span>
      </button>
      {expanded && (
        <p className="mt-2 pl-6 text-sm text-muted-foreground leading-relaxed">
          {item.answer}
        </p>
      )}
    </div>
  );
}
