/**
 * Pre-charting panel: shows the N most recent SOAP notes for a patient
 * so the therapist can reference prior sessions while documenting today's.
 *
 * Backed by GET /api/soap-notes/recent. Tenant-guarded server-side.
 * Renders a collapsible card showing the most recent note expanded by
 * default; older notes show as one-line headers that expand on click.
 *
 * Designed to be embedded next to the SOAP creation form — pulls only
 * when a patientId is supplied.
 */
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, ChevronRight, FileText, Pencil } from 'lucide-react';

interface PriorNote {
  id: number;
  sessionId: number;
  subjective?: string | null;
  objective?: string | null;
  assessment?: string | null;
  plan?: string | null;
  interventions?: any;
  therapistSignedAt?: string | null;
  therapistSignedName?: string | null;
  createdAt: string;
}

interface Props {
  patientId: number | null | undefined;
  /** Defaults to 5. Server bounds 1..20. */
  limit?: number;
  /** Renders nothing if true — useful for hiding via setting. */
  hidden?: boolean;
}

export default function PriorSessionNotesPanel({ patientId, limit = 5, hidden = false }: Props) {
  const enabled = !!patientId && !hidden;
  const { data: notes = [], isLoading } = useQuery<PriorNote[]>({
    queryKey: [`/api/soap-notes/recent?patientId=${patientId}&limit=${limit}`],
    enabled,
    retry: false,
  });
  // Most recent note (index 0) is open by default; the rest are collapsed.
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const isExpanded = (i: number, id: number) => i === 0 ? !expandedIds.has(-id) : expandedIds.has(id);
  const toggle = (i: number, id: number) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      // For index 0 (default-open), we toggle by inserting the negative id to flip it closed.
      const key = i === 0 ? -id : id;
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  if (hidden || !patientId) return null;

  return (
    <Card className="border-blue-100 bg-blue-50/30" data-testid="card-prior-session-notes">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <FileText className="w-4 h-4 text-blue-600" />
          Previous sessions
          {notes.length > 0 && (
            <Badge variant="secondary" className="ml-auto text-[10px]">
              {notes.length} on file
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading && (
          <p className="text-xs text-slate-500">Loading prior notes…</p>
        )}
        {!isLoading && notes.length === 0 && (
          <p className="text-xs text-slate-500 flex items-center gap-1.5">
            <Pencil className="w-3 h-3" />
            No prior SOAP notes on file. This is the first one.
          </p>
        )}
        {notes.map((n, i) => {
          const date = n.createdAt ? new Date(n.createdAt).toLocaleDateString() : 'Unknown date';
          const open = isExpanded(i, n.id);
          const interventionsList = Array.isArray(n.interventions)
            ? n.interventions.slice(0, 4).join(', ')
            : null;
          return (
            <div
              key={n.id}
              className="rounded-md border border-blue-100 bg-white"
              data-testid={`prior-note-${n.id}`}
            >
              <button
                type="button"
                className="w-full text-left p-2 flex items-center gap-2 hover:bg-blue-50/50"
                onClick={() => toggle(i, n.id)}
              >
                {open ? (
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                )}
                <span className="text-xs font-medium text-slate-700">{date}</span>
                {n.therapistSignedAt ? (
                  <Badge variant="outline" className="text-[10px] border-green-300 text-green-700">
                    signed
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-700">
                    unsigned
                  </Badge>
                )}
                {n.therapistSignedName && (
                  <span className="text-[10px] text-slate-500">{n.therapistSignedName}</span>
                )}
              </button>
              {open && (
                <div className="px-3 pb-3 text-xs space-y-2 border-t border-blue-100 bg-slate-50/40">
                  {n.subjective && (
                    <div>
                      <div className="font-semibold text-slate-600 uppercase tracking-wide text-[10px] mt-2 mb-0.5">Subjective</div>
                      <p className="text-slate-700 whitespace-pre-wrap">{n.subjective}</p>
                    </div>
                  )}
                  {n.objective && (
                    <div>
                      <div className="font-semibold text-slate-600 uppercase tracking-wide text-[10px] mb-0.5">Objective</div>
                      <p className="text-slate-700 whitespace-pre-wrap">{n.objective}</p>
                    </div>
                  )}
                  {n.assessment && (
                    <div>
                      <div className="font-semibold text-slate-600 uppercase tracking-wide text-[10px] mb-0.5">Assessment</div>
                      <p className="text-slate-700 whitespace-pre-wrap">{n.assessment}</p>
                    </div>
                  )}
                  {n.plan && (
                    <div>
                      <div className="font-semibold text-slate-600 uppercase tracking-wide text-[10px] mb-0.5">Plan</div>
                      <p className="text-slate-700 whitespace-pre-wrap">{n.plan}</p>
                    </div>
                  )}
                  {interventionsList && (
                    <div>
                      <div className="font-semibold text-slate-600 uppercase tracking-wide text-[10px] mb-0.5">Interventions</div>
                      <p className="text-slate-700">{interventionsList}{Array.isArray(n.interventions) && n.interventions.length > 4 ? `, +${n.interventions.length - 4} more` : ''}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
