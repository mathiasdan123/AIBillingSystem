/**
 * One section (Subjective / Objective / Assessment / Plan) of a generated SOAP
 * note, with an inline edit path.
 *
 * Therapist review and correction of AI output before signing is the core
 * compliance promise of this product (the disclaimer says every coding and
 * documentation decision is the treating provider's), but until this existed
 * the generated sections rendered as plain paragraphs with no edit control —
 * while the Documentation Check copy told users they could "edit the sections
 * above directly" (QA sweep 2026-11-18). Now each section has an Edit button
 * that swaps the text for a textarea; Save writes back through `onSave`, which
 * the page routes into the same note state that Save, the autosaved draft and
 * the doc-check all read, so an edit is what gets stored. A saved edit is
 * flagged "Edited by therapist" so a reviewer can tell therapist text from
 * model text at a glance.
 *
 * `children`, when given, replaces the default paragraph in VIEW mode (the
 * Plan section renders a suggestion card; Objective appends the CPT pairing
 * editor). Edit mode always edits the raw section text.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Pencil, Check, X } from "lucide-react";

export type SoapSectionKey = "subjective" | "objective" | "assessment" | "plan";

interface Props {
  sectionKey: SoapSectionKey;
  label: string;
  /** Tailwind text color for the section label, e.g. "text-blue-600". */
  labelClassName: string;
  value: string;
  /** True once the therapist has saved an edit to this section. */
  edited: boolean;
  onSave: (text: string) => void;
  /** Disable editing (e.g. while the AI is rewriting the note). */
  disabled?: boolean;
  /** Optional view-mode rendering in place of the plain paragraph. */
  children?: React.ReactNode;
  /** Extra content rendered under the text in view mode only. */
  footer?: React.ReactNode;
}

export default function GeneratedSoapSection({
  sectionKey,
  label,
  labelClassName,
  value,
  edited,
  onSave,
  disabled,
  children,
  footer,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const startEdit = () => {
    setDraft(value);
    setEditing(true);
  };
  const cancel = () => setEditing(false);
  const save = () => {
    onSave(draft);
    setEditing(false);
  };

  return (
    <div data-testid={`soap-section-${sectionKey}`}>
      <div className="flex items-center justify-between gap-2">
        <Label className={`text-xs font-semibold ${labelClassName} flex items-center gap-2`}>
          {label}
          {edited && (
            <Badge
              variant="outline"
              className="h-5 px-1.5 text-[10px] font-medium border-slate-400 text-slate-700"
              data-testid={`badge-edited-${sectionKey}`}
            >
              Edited by therapist
            </Badge>
          )}
        </Label>
        {!editing && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={startEdit}
            disabled={disabled}
            aria-label={`Edit ${label.toLowerCase()}`}
            data-testid={`button-edit-${sectionKey}`}
          >
            <Pencil className="w-3 h-3 mr-1" />
            Edit
          </Button>
        )}
      </div>
      {editing ? (
        <div className="mt-1 space-y-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={Math.min(14, Math.max(4, draft.split("\n").length + 1))}
            className="text-sm"
            aria-label={`${label} text`}
            data-testid={`textarea-edit-${sectionKey}`}
          />
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              className="h-7 text-xs"
              onClick={save}
              data-testid={`button-save-${sectionKey}`}
            >
              <Check className="w-3 h-3 mr-1" />
              Save section
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={cancel}
              data-testid={`button-cancel-${sectionKey}`}
            >
              <X className="w-3 h-3 mr-1" />
              Cancel
            </Button>
            <span className="text-[10px] text-muted-foreground">
              Your text replaces the generated text for this section.
            </span>
          </div>
        </div>
      ) : (
        <>
          {children ?? (
            <p className="mt-1 text-foreground whitespace-pre-line" data-testid={`text-${sectionKey}`}>
              {value}
            </p>
          )}
          {footer}
        </>
      )}
    </div>
  );
}
