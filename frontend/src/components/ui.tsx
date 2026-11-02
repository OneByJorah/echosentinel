import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { X } from 'lucide-react';
import type { ServiceState } from '../lib/types';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

export function Panel({ title, icon, actions, children, className, bodyClass }: { title?: ReactNode; icon?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={cx('panel flex min-w-0 flex-col', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 pb-2 pt-3.5">
          {icon && <span className="text-amber">{icon}</span>}
          {title && <h2 className="text-[15px] font-semibold tracking-tight text-bone">{title}</h2>}
          <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>
        </header>
      )}
      <div className={cx('min-h-0 flex-1 px-4 pb-4', bodyClass)}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-bone-muted">{subtitle}</p>}
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>
    </div>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'ghost' | 'danger'; disabledReason?: string | false };

/** Button that, when disabled for a reason (e.g. role), explains why via tooltip. */
export function Button({ variant = 'default', disabledReason, className, disabled, title, children, ...rest }: BtnProps) {
  const isDisabled = disabled || !!disabledReason;
  const btn = (
    <button
      type="button"
      className={cx('btn', variant === 'primary' && 'btn-primary', variant === 'ghost' && 'btn-ghost', variant === 'danger' && 'btn-danger', className)}
      disabled={isDisabled}
      title={disabledReason || title}
      aria-disabled={isDisabled}
      {...rest}
    >
      {children}
    </button>
  );
  // Disabled buttons don't emit hover events in some browsers; wrap so the tooltip still shows.
  return disabledReason ? (
    <span title={disabledReason} className="inline-flex">
      {btn}
    </span>
  ) : (
    btn
  );
}

export function IconButton({ label, disabledReason, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; disabledReason?: string | false }) {
  const b = (
    <button type="button" aria-label={label} title={disabledReason || label} className={cx('btn-icon', className)} disabled={rest.disabled || !!disabledReason} {...rest}>
      {children}
    </button>
  );
  return disabledReason ? (
    <span title={disabledReason} className="inline-flex">
      {b}
    </span>
  ) : (
    b
  );
}

export type Tone = 'ok' | 'bad' | 'warn' | 'amber' | 'muted' | 'speech';

const toneDot: Record<Tone, string> = {
  ok: 'bg-ok',
  bad: 'bg-bad',
  warn: 'bg-warn',
  amber: 'bg-amber',
  muted: 'bg-bone-dim',
  speech: 'bg-speech',
};
const toneText: Record<Tone, string> = {
  ok: 'text-ok',
  bad: 'text-bad',
  warn: 'text-warn',
  amber: 'text-amber',
  muted: 'text-bone-muted',
  speech: 'text-speech',
};

export function Dot({ tone, pulse, className }: { tone: Tone; pulse?: boolean; className?: string }) {
  return <span aria-hidden className={cx('inline-block h-2.5 w-2.5 shrink-0 rounded-full', toneDot[tone], pulse && 'animate-live', className)} />;
}

export function Badge({ tone = 'muted', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  const bg: Record<Tone, string> = {
    ok: 'bg-ok/15 text-ok',
    bad: 'bg-bad/15 text-bad',
    warn: 'bg-warn/15 text-warn',
    amber: 'bg-amber/15 text-amber',
    muted: 'bg-ink-600 text-bone-muted',
    speech: 'bg-speech/15 text-speech',
  };
  return <span className={cx('chip', bg[tone], className)}>{children}</span>;
}

export function toneText_(t: Tone) {
  return toneText[t];
}

export function serviceTone(s: ServiceState | undefined): Tone {
  switch (s) {
    case 'ready':
    case 'running':
    case 'active':
      return 'ok';
    case 'loading':
    case 'degraded':
      return 'warn';
    case 'error':
    case 'unreachable':
    case 'stopped':
      return 'bad';
    default:
      return 'muted';
  }
}

export function serviceLabel(s: ServiceState | undefined): string {
  if (!s) return 'Unknown';
  const map: Partial<Record<ServiceState, string>> = {
    ready: 'Ready',
    loading: 'Loading model',
    not_installed: 'Not installed',
    not_configured: 'Not configured',
    disabled: 'Disabled',
    error: 'Error',
    running: 'Running',
    unreachable: 'Unreachable',
    active: 'Active',
    degraded: 'Degraded',
    stopped: 'Stopped',
    unavailable: 'Unavailable',
  };
  return map[s] ?? s;
}

export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cx('inline-block animate-pulse rounded bg-ink-600/70', className)} />;
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center">
      {icon && <div className="text-bone-dim">{icon}</div>}
      <p className="text-sm font-medium text-bone">{title}</p>
      {children && <div className="max-w-sm text-sm text-bone-muted">{children}</div>}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      {children(id)}
      {hint && <p className="mt-1 text-xs text-bone-dim">{hint}</p>}
    </div>
  );
}

export function Toggle({ checked, onChange, label, disabled, title, ariaLabel }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; title?: string; ariaLabel?: string }) {
  return (
    <label className={cx('inline-flex cursor-pointer select-none items-center gap-2 text-sm', disabled && 'cursor-not-allowed opacity-50')} title={title}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx('relative h-5 w-9 shrink-0 rounded-full border transition-colors', checked ? 'border-amber bg-amber' : 'border-ink-500 bg-ink-700')}
      >
        <span className={cx('absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all', checked ? 'left-[18px] bg-ink' : 'left-0.5 bg-bone-muted')} />
      </button>
      {label && <span>{label}</span>}
    </label>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs, className }: { value: T; onChange: (v: T) => void; tabs: { id: T; label: ReactNode; badge?: ReactNode }[]; className?: string }) {
  return (
    <div role="tablist" className={cx('flex gap-1 rounded-lg border border-ink-600 bg-ink-850 p-1', className)}>
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          type="button"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cx(
            'flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            value === t.id ? 'bg-amber/15 text-amber ring-1 ring-amber/50' : 'text-bone-muted hover:bg-ink-700 hover:text-bone',
          )}
        >
          {t.label}
          {t.badge}
        </button>
      ))}
    </div>
  );
}

export function Dialog({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => ref.current?.querySelector<HTMLElement>('input,button,select,textarea,[tabindex]')?.focus(), 10);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/65 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={cx('panel max-h-[92vh] w-full overflow-auto rounded-b-none sm:rounded-xl', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}>
        <div className="sticky top-0 z-10 flex items-center border-b border-ink-600 bg-ink-800 px-4 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button type="button" className="btn-icon ml-auto h-8 w-8" aria-label="Close" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

export function Meter({ value, tone = 'amber', label }: { value: number | null; tone?: Tone; label: string }) {
  const v = value === null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-600" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value ?? undefined}>
      <div className={cx('h-full rounded-full', toneDot[tone])} style={{ width: `${v}%` }} />
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return <p className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bone">{error instanceof Error ? error.message : String(error)}</p>;
}
