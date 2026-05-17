interface Props {
  /** Render only if true. Lets callers do `<DemoBadge show={p.isDemo} />` without a wrapping ternary. */
  show?: boolean;
  className?: string;
}

/**
 * Tiny yellow chip that marks a row (patient / claim / appointment) as demo
 * data — created by enable_demo_mode or flagged via mark_patients_as_demo.
 *
 * Visual signal so the user (and any prospect being shown the product) can't
 * confuse demo rows with real ones. Pairs with the Phase 5 server-side
 * firewall that refuses to submit/send/charge demo rows.
 */
export function DemoBadge({ show = true, className = "" }: Props) {
  if (!show) return null;
  return (
    <span
      className={
        "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide " +
        "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200 " +
        "border border-amber-200 dark:border-amber-800 " +
        className
      }
      title="Demo data — excluded from analytics, refused by submit/send/charge"
      data-testid="demo-badge"
    >
      DEMO
    </span>
  );
}
