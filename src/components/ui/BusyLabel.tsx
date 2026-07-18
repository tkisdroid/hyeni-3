import "./BusyLabel.css";

interface BusyLabelProps {
  busy: boolean;
  idle: string;
  pending: string;
}

export function BusyLabel({ busy, idle, pending }: BusyLabelProps) {
  return (
    <span className="hy-busy-label" aria-live="polite" aria-atomic="true">
      {busy ? (
        <>
          <span className="hy-busy-label__spinner" aria-hidden="true" />
          <span>{pending}</span>
        </>
      ) : (
        <span>{idle}</span>
      )}
    </span>
  );
}
