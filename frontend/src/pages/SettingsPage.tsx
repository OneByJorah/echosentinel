import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Save, SlidersHorizontal, HardDrive, Bot, Bell } from 'lucide-react';
import { api } from '../lib/api';
import { EVENT_CATEGORIES, type Settings } from '../lib/types';
import { categoryLabel } from '../lib/format';
import { useSettings } from '../hooks/queries';
import { useAuth } from '../hooks/useAuth';
import { errText, useToast } from '../hooks/useToast';
import { ErrorNote, PageHeader, Panel, Skeleton, Toggle } from '../components/ui';

function Num({ id, label, value, onChange, min, max, step, disabled, hint }: { id: string; label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; disabled?: boolean; hint?: string }) {
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <input id={id} type="number" className="input num" value={value} min={min} max={max} step={step} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} />
      {hint && <p className="mt-1 text-xs text-bone-dim">{hint}</p>}
    </div>
  );
}

export default function SettingsPage() {
  const q = useSettings();
  const { can } = useAuth();
  const admin = can('admin');
  const toast = useToast();
  const qc = useQueryClient();
  const [s, setS] = useState<Settings | null>(null);
  useEffect(() => {
    if (q.data) setS(structuredClone(q.data));
  }, [q.data]);
  const save = useMutation({
    mutationFn: (v: Settings) => api<Settings>('/settings', { method: 'PUT', body: v }),
    onSuccess: (v) => {
      qc.setQueryData(['settings'], v);
      toast('ok', 'Settings saved');
    },
    onError: (e) => toast('error', errText(e)),
  });
  const dis = !admin;
  const tip = dis ? 'Requires the admin role' : undefined;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Settings"
        subtitle={admin ? 'Changes apply immediately after saving.' : 'Read-only — settings can be changed by an admin.'}
        actions={
          s && (
            <span title={tip} className="inline-flex">
              <button type="button" className="btn btn-primary" disabled={dis || save.isPending} onClick={() => save.mutate(s)}>
                <Save className="h-4 w-4" /> Save settings
              </button>
            </span>
          )
        }
      />
      <ErrorNote error={q.error} />
      {!s ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          <Panel title="Storage & retention" icon={<HardDrive className="h-5 w-5" />}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Num id="ret" label="Keep audio for (days)" value={s.retention_days} min={1} disabled={dis} onChange={(v) => setS({ ...s, retention_days: v })} />
              <Num id="tret" label="Keep transcripts for (days)" value={s.transcript_retention_days} min={1} disabled={dis} onChange={(v) => setS({ ...s, transcript_retention_days: v })} />
              <Num id="quota" label="Storage quota (GB)" value={s.max_storage_gb} min={1} disabled={dis} onChange={(v) => setS({ ...s, max_storage_gb: v })} hint="Oldest EchoSentinel recordings are removed first." />
              <Num id="free" label="Stop recording below free (GB)" value={s.min_free_gb} min={0} step={0.5} disabled={dis} onChange={(v) => setS({ ...s, min_free_gb: v })} />
              <Num id="seg" label="Segment length (minutes)" value={s.segment_minutes} min={1} max={240} disabled={dis} onChange={(v) => setS({ ...s, segment_minutes: v })} hint="Applies to new segments." />
            </div>
          </Panel>

          <Panel title="Transcription & notifications" icon={<Bell className="h-5 w-5" />}>
            <div className="space-y-3">
              <div>
                <label className="label" htmlFor="lang">
                  Speech language
                </label>
                <select id="lang" className="input" value={s.stt_language} disabled={dis} onChange={(e) => setS({ ...s, stt_language: e.target.value })}>
                  <option value="auto">Detect automatically</option>
                  <option value="en">English</option>
                  <option value="es">Spanish</option>
                  <option value="fr">French</option>
                  <option value="nl">Dutch</option>
                  <option value="pt">Portuguese</option>
                </select>
              </div>
              <Toggle checked={s.redact_notifications} disabled={dis} title={tip} onChange={(v) => setS({ ...s, redact_notifications: v })} label="Redact personal details in notification previews" />
            </div>
          </Panel>

          <Panel title="Sound detection thresholds" icon={<SlidersHorizontal className="h-5 w-5" />} className="xl:col-span-2">
            <p className="mb-3 text-xs text-bone-muted">Higher thresholds mean fewer false alarms but more missed sounds. Cooldown suppresses repeats of the same sound on the same channel.</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead className="text-left text-xs text-bone-muted">
                  <tr>
                    <th className="py-1.5 font-medium">Sound</th>
                    <th className="py-1.5 font-medium">Enabled</th>
                    <th className="py-1.5 font-medium">Threshold</th>
                    <th className="py-1.5 font-medium">Cooldown (s)</th>
                  </tr>
                </thead>
                <tbody>
                  {EVENT_CATEGORIES.filter((c) => s.thresholds[c]).map((c) => {
                    const t = s.thresholds[c];
                    const set = (p: Partial<typeof t>) => setS({ ...s, thresholds: { ...s.thresholds, [c]: { ...t, ...p } } });
                    return (
                      <tr key={c} className="border-t border-ink-600/60">
                        <td className="py-2">{categoryLabel(c)}</td>
                        <td className="py-2">
                          <Toggle checked={t.enabled} disabled={dis} onChange={(v) => set({ enabled: v })} label="" ariaLabel={`Detect ${categoryLabel(c)}`} />
                        </td>
                        <td className="py-2">
                          <div className="flex items-center gap-2">
                            <input type="range" min={0.05} max={0.95} step={0.05} value={t.threshold} disabled={dis} className="w-32 accent-amber" aria-label={`${categoryLabel(c)} threshold`} onChange={(e) => set({ threshold: Number(e.target.value) })} />
                            <span className="num w-10">{t.threshold.toFixed(2)}</span>
                          </div>
                        </td>
                        <td className="py-2">
                          <input type="number" min={0} className="input num w-24 py-1" value={t.cooldown_s} disabled={dis} aria-label={`${categoryLabel(c)} cooldown`} onChange={(e) => set({ cooldown_s: Number(e.target.value) })} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel title="Ollama (text reasoning)" icon={<Bot className="h-5 w-5" />}>
            <div className="space-y-3">
              <Toggle checked={s.ollama.enabled} disabled={dis} onChange={(v) => setS({ ...s, ollama: { ...s.ollama, enabled: v } })} label="Use Ollama for summaries" />
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="ol-url">
                    Server URL
                  </label>
                  <input id="ol-url" className="input num" value={s.ollama.url} disabled={dis} onChange={(e) => setS({ ...s, ollama: { ...s.ollama, url: e.target.value } })} />
                </div>
                <div>
                  <label className="label" htmlFor="ol-model">
                    Model
                  </label>
                  <input id="ol-model" className="input num" value={s.ollama.model} disabled={dis} onChange={(e) => setS({ ...s, ollama: { ...s.ollama, model: e.target.value } })} />
                </div>
                <Num id="ol-to" label="Timeout (s)" value={s.ollama.timeout_s} min={5} max={600} disabled={dis} onChange={(v) => setS({ ...s, ollama: { ...s.ollama, timeout_s: v } })} />
              </div>
            </div>
          </Panel>

          <PasswordPanel />
        </div>
      )}
    </div>
  );
}

function PasswordPanel() {
  const toast = useToast();
  const [f, setF] = useState({ current_password: '', new_password: '', confirm: '' });
  const m = useMutation({
    mutationFn: () => api('/auth/password', { method: 'POST', body: { current_password: f.current_password, new_password: f.new_password } }),
    onSuccess: () => {
      setF({ current_password: '', new_password: '', confirm: '' });
      toast('ok', 'Password changed');
    },
  });
  const mismatch = f.confirm.length > 0 && f.confirm !== f.new_password;
  return (
    <Panel title="Change password" icon={<KeyRound className="h-5 w-5" />}>
      <form
        className="grid gap-3 sm:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!mismatch) m.mutate();
        }}
      >
        <div>
          <label className="label" htmlFor="pw-c">
            Current
          </label>
          <input id="pw-c" type="password" autoComplete="current-password" className="input" required value={f.current_password} onChange={(e) => setF({ ...f, current_password: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor="pw-n">
            New
          </label>
          <input id="pw-n" type="password" autoComplete="new-password" minLength={10} className="input" required value={f.new_password} onChange={(e) => setF({ ...f, new_password: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor="pw-r">
            Repeat new
          </label>
          <input id="pw-r" type="password" autoComplete="new-password" className="input" required value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} aria-invalid={mismatch} />
        </div>
        {mismatch && <p className="text-sm text-bad sm:col-span-3">The new passwords don't match.</p>}
        <div className="sm:col-span-3">
          <ErrorNote error={m.error} />
          <button type="submit" className="btn btn-primary mt-1" disabled={m.isPending || mismatch}>
            Change password
          </button>
        </div>
      </form>
    </Panel>
  );
}
