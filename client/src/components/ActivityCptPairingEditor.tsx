import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { type ActivityCptPairing, cptNameFor } from "@shared/activityCpt";

/**
 * Per-activity CPT pairing editor (Objective section).
 *
 * Megan's ask with Kelli's conditions: each activity documented in the
 * Objective is shown WITH its suggested CPT code, and the therapist can
 * always change every code — the selector draws from the practice's CPT
 * catalog. Pairings flagged `source: 'default'` were conservatively
 * defaulted to 97530 Therapeutic Activities because nothing more specific
 * was clearly supported; they get a visible badge so the therapist knows
 * to review them. Suggestions are never final: the treating provider makes
 * every coding decision (disclaimer rendered below the list).
 */
export interface CptCatalogEntry {
  id: number;
  code: string;
  description: string;
}

interface Props {
  pairings: ActivityCptPairing[];
  /** Practice CPT catalog (from /api/cpt-codes). Falls back to the pairing's own code when empty. */
  catalog?: CptCatalogEntry[];
  onCodeChange: (activity: string, code: string) => void;
  disabled?: boolean;
}

export default function ActivityCptPairingEditor({ pairings, catalog, onCodeChange, disabled }: Props) {
  if (!pairings || pairings.length === 0) return null;

  const optionsFor = (pairing: ActivityCptPairing): Array<{ code: string; label: string }> => {
    const seen = new Set<string>();
    const options: Array<{ code: string; label: string }> = [];
    for (const entry of catalog ?? []) {
      if (!entry?.code || seen.has(entry.code)) continue;
      seen.add(entry.code);
      options.push({ code: entry.code, label: `${entry.code} — ${entry.description}` });
    }
    // The current code must always be selectable even if the catalog hasn't
    // loaded (or doesn't contain it), so the Select never shows blank.
    if (!seen.has(pairing.code)) {
      options.unshift({ code: pairing.code, label: `${pairing.code} — ${cptNameFor(pairing.code, pairing.name)}` });
    }
    return options;
  };

  return (
    <div className="mt-2 space-y-2" data-testid="activity-cpt-pairing-editor">
      <p className="text-xs font-medium text-muted-foreground">Activity ↔ CPT code pairing</p>
      {pairings.map((pairing) => (
        <div
          key={pairing.activity}
          className="flex items-start gap-2 p-2 bg-slate-50 rounded-lg border"
          data-testid={`activity-cpt-pairing-${pairing.activity}`}
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium">{pairing.activity}</span>
              {pairing.source === "default" && (
                <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-700" data-testid={`badge-conservative-default-${pairing.activity}`}>
                  Conservative default — review
                </Badge>
              )}
              {pairing.source === "therapist" && (
                <Badge variant="outline" className="text-[10px] border-blue-300 text-blue-700">
                  Edited by therapist
                </Badge>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">{pairing.rationale}</p>
          </div>
          <Select
            value={pairing.code}
            disabled={disabled}
            onValueChange={(newCode) => {
              if (newCode && newCode !== pairing.code) onCodeChange(pairing.activity, newCode);
            }}
          >
            <SelectTrigger
              className="w-36 h-8 text-xs shrink-0"
              aria-label={`CPT code for ${pairing.activity}`}
              data-testid={`select-cpt-${pairing.activity}`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {optionsFor(pairing).map((opt) => (
                <SelectItem key={opt.code} value={opt.code} className="text-xs">
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ))}
      <p className="text-[11px] text-muted-foreground" data-testid="pairing-disclaimer">
        AI-suggested codes based on the documented care — the treating provider reviews and
        approves all coding decisions. Changing a code here updates the billing codes above.
      </p>
    </div>
  );
}
