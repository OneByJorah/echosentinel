import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Link2, Loader2, Plus, Send, Sparkles, Trash2, Webhook as WebhookIcon, Zap } from 'lucide-react';
import { api } from '../lib/api';
import { EVENT_CATEGORIES, type Rule, type Summary, type TelegramConfig, type Webhook } from '../lib/types';
import { categoryLabel, channelLabel, clock, dateTime, fromLocalInput, toLocalInput } from '../lib/format';
import { useChannels, usePipeline } from '../hooks/queries';
import { useAuth } from '../hooks/useAuth';
import { errText, useToast } from '../hooks/useToast';
import { Badge, Button, Dialog, Empty, ErrorNote, PageHeader, Panel, Toggle, serviceLabel } from '../components/ui';

export default function Automation() {
  return (
    <div className="space-y-4">
      <PageHeader title="Automation" subtitle="Alerts, webhooks and AI summaries. Everything runs on this server; nothing is sent anywhere you haven't configured." />
      <div className="grid gap-4 xl:grid-cols-2">
        <TelegramPanel />
        <RulesPanel />
        <WebhooksPanel />
        <SummariesPanel />
      </div>
    </div>
  );
}

function TelegramPanel() {
  const { can } = useAuth();
  const admin = can('admin');
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['telegram'], queryFn: () => api<TelegramConfig>('/automation/telegram'), enabled: admin });
  const [cfg, setCfg] = useState<TelegramConfig | null>(null);
  const [token, setToken] = useState('');
  useEffect(() => {
    if (q.data) setCfg(q.data);
  }, [q.data]);
  const save = useMutation({
    mutationFn: (c: TelegramConfig) => api<TelegramConfig>('/automation/telegram', { method: 'PUT', body: { ...c, bot_token: token || undefined } }),
    onSuccess: (c) => {
      setToken('');
      qc.setQueryData(['telegram'], c);
      toast('ok', 'Telegram settings saved');
    },
    onError: (e) => toast('error', errText(e)),
  });
  const test = useMutation({
    mutationFn: () => api<{ ok: boolean; error: string | null }>('/automation/telegram/test', { method: 'POST' }),
    onSuccess: (r) => toast(r.ok ? 'ok' : 'error', r.ok ? 'Test message sent' : `Test failed: ${r.error}`),
    onError: (e) => toast('error', errText(e)),
  });
  return (
    <Panel title="Telegram alerts" icon={<Send className="h-5 w-5" />}>
      {!admin ? (
        <p className="text-sm text-bone-muted">Requires the admin role.</p>
      ) : !cfg ? (
        <ErrorNote error={q.error} />
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(cfg);
          }}
        >
          <Toggle checked={cfg.enabled} onChange={(v) => setCfg({ ...cfg, enabled: v })} label="Send alerts to Telegram" />
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="tg-token">
                Bot token
              </label>
              <input id="tg-token" type="password" autoComplete="off" className="input num" placeholder={cfg.token_set ? 'Saved — leave blank to keep' : 'From @BotFather'} value={token} onChange={(e) => setToken(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="tg-chat">
                Chat ID
              </label>
              <input id="tg-chat" className="input num" value={cfg.chat_id} onChange={(e) => setCfg({ ...cfg, chat_id: e.target.value })} />
            </div>
          </div>
          <Toggle checked={cfg.include_transcript} onChange={(v) => setCfg({ ...cfg, include_transcript: v })} label="Include transcript text in alerts (off keeps alerts minimal)" />
          <div className="flex flex-wrap items-end gap-3">
            <Toggle checked={!!cfg.quiet_hours} onChange={(v) => setCfg({ ...cfg, quiet_hours: v ? { start: '22:00', end: '07:00' } : null })} label="Quiet hours" />
            {cfg.quiet_hours && (
              <>
                <input type="time" className="input num w-28" aria-label="Quiet hours start" value={cfg.quiet_hours.start} onChange={(e) => setCfg({ ...cfg, quiet_hours: { ...cfg.quiet_hours!, start: e.target.value } })} />
                <span className="text-bone-muted">to</span>
                <input type="time" className="input num w-28" aria-label="Quiet hours end" value={cfg.quiet_hours.end} onChange={(e) => setCfg({ ...cfg, quiet_hours: { ...cfg.quiet_hours!, end: e.target.value } })} />
              </>
            )}
          </div>
          <div className="flex gap-2">
            <button type="submit" className="btn btn-primary" disabled={save.isPending}>
              Save
            </button>
            <Button onClick={() => test.mutate()} disabled={test.isPending || !cfg.token_set}>
              {test.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Send test message
            </Button>
          </div>
        </form>
      )}
    </Panel>
  );
}

const emptyRule: Omit<Rule, 'id'> = { name: '', enabled: true, categories: [], channel_ids: [], min_score: 0.6, cooldown_s: 120, actions: ['telegram'] };

function RulesPanel() {
  const { can } = useAuth();
  const admin = can('admin');
  const { channels } = useChannels();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['rules'], queryFn: () => api<Rule[]>('/automation/rules'), enabled: admin });
  const [edit, setEdit] = useState<(Omit<Rule, 'id'> & { id?: number }) | null>(null);
  const save = useMutation({
    mutationFn: (r: Omit<Rule, 'id'> & { id?: number }) => (r.id ? api<Rule>(`/automation/rules/${r.id}`, { method: 'PUT', body: r }) : api<Rule>('/automation/rules', { method: 'POST', body: r })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['rules'] });
      setEdit(null);
      toast('ok', 'Rule saved');
    },
  });
  const del = useMutation({
    mutationFn: (id: number) => api(`/automation/rules/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['rules'] });
      toast('ok', 'Rule deleted');
    },
    onError: (e) => toast('error', errText(e)),
  });
  const chName = (id: number) => {
    const c = channels?.find((x) => x.id === id);
    return c ? channelLabel(c.slot) : `#${id}`;
  };
  return (
    <Panel
      title="Alert rules"
      icon={<Zap className="h-5 w-5" />}
      actions={
        <Button onClick={() => setEdit({ ...emptyRule })} disabledReason={!admin && 'Requires the admin role'}>
          <Plus className="h-4 w-4" /> Add rule
        </Button>
      }
    >
      {!admin ? (
        <p className="text-sm text-bone-muted">Requires the admin role.</p>
      ) : q.data?.length ? (
        <ul className="space-y-2">
          {q.data.map((r) => (
            <li key={r.id} className="panel-inset flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
              <span className="font-medium">{r.name}</span>
              {!r.enabled && <Badge>off</Badge>}
              <span className="text-bone-muted">{r.categories.length ? r.categories.map(categoryLabel).join(', ') : 'Any sound'}</span>
              <span className="num text-xs text-bone-dim">
                ≥{r.min_score} · {r.channel_ids.length ? r.channel_ids.map(chName).join(' ') : 'all channels'} · cooldown {r.cooldown_s}s · {r.actions.join('+')}
              </span>
              <div className="ml-auto flex gap-1">
                <button type="button" className="btn px-2 py-1 text-xs" onClick={() => setEdit(r)}>
                  Edit
                </button>
                <button type="button" className="btn-icon h-8 w-8" aria-label={`Delete rule ${r.name}`} onClick={() => del.mutate(r.id)}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <Empty title="No alert rules">Add a rule to get notified when specific sounds are detected.</Empty>
      )}
      {edit && (
        <Dialog open onClose={() => setEdit(null)} title={edit.id ? 'Edit rule' : 'New rule'}>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(edit);
            }}
          >
            <div>
              <label className="label" htmlFor="r-name">
                Name
              </label>
              <input id="r-name" className="input" required value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </div>
            <fieldset>
              <legend className="label">Sound types (none = any)</legend>
              <div className="flex flex-wrap gap-1.5">
                {EVENT_CATEGORIES.map((c) => {
                  const on = edit.categories.includes(c);
                  return (
                    <button key={c} type="button" aria-pressed={on} className={`chip border px-2 py-1 ${on ? 'border-amber bg-amber/15 text-amber' : 'border-ink-500 text-bone-muted'}`} onClick={() => setEdit({ ...edit, categories: on ? edit.categories.filter((x) => x !== c) : [...edit.categories, c] })}>
                      {categoryLabel(c)}
                    </button>
                  );
                })}
              </div>
            </fieldset>
            <fieldset>
              <legend className="label">Channels (none = all)</legend>
              <div className="flex flex-wrap gap-1.5">
                {channels?.map((c) => {
                  const on = edit.channel_ids.includes(c.id);
                  return (
                    <button key={c.id} type="button" aria-pressed={on} className={`chip border px-2 py-1 ${on ? 'border-amber bg-amber/15 text-amber' : 'border-ink-500 text-bone-muted'}`} onClick={() => setEdit({ ...edit, channel_ids: on ? edit.channel_ids.filter((x) => x !== c.id) : [...edit.channel_ids, c.id] })}>
                      {channelLabel(c.slot, c.name)}
                    </button>
                  );
                })}
              </div>
            </fieldset>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="r-min">
                  Minimum score
                </label>
                <input id="r-min" type="number" step={0.05} min={0} max={1} className="input num" value={edit.min_score} onChange={(e) => setEdit({ ...edit, min_score: Number(e.target.value) })} />
              </div>
              <div>
                <label className="label" htmlFor="r-cd">
                  Cooldown (s)
                </label>
                <input id="r-cd" type="number" min={0} className="input num" value={edit.cooldown_s} onChange={(e) => setEdit({ ...edit, cooldown_s: Number(e.target.value) })} />
              </div>
            </div>
            <div className="flex flex-wrap gap-4">
              {(['telegram', 'webhook'] as const).map((a) => (
                <Toggle key={a} checked={edit.actions.includes(a)} onChange={(v) => setEdit({ ...edit, actions: v ? [...edit.actions, a] : edit.actions.filter((x) => x !== a) })} label={a === 'telegram' ? 'Telegram' : 'Webhooks'} />
              ))}
              <Toggle checked={edit.enabled} onChange={(v) => setEdit({ ...edit, enabled: v })} label="Enabled" />
            </div>
            <ErrorNote error={save.error} />
            <div className="flex justify-end">
              <button type="submit" className="btn btn-primary" disabled={save.isPending}>
                Save rule
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </Panel>
  );
}

function WebhooksPanel() {
  const { can } = useAuth();
  const admin = can('admin');
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['webhooks'], queryFn: () => api<Webhook[]>('/automation/webhooks'), enabled: admin });
  const [form, setForm] = useState({ name: '', url: '', secret: '' });
  const add = useMutation({
    mutationFn: () => api<Webhook>('/automation/webhooks', { method: 'POST', body: { name: form.name, url: form.url, secret: form.secret || undefined } }),
    onSuccess: () => {
      setForm({ name: '', url: '', secret: '' });
      void qc.invalidateQueries({ queryKey: ['webhooks'] });
      toast('ok', 'Webhook added');
    },
  });
  const del = useMutation({
    mutationFn: (id: number) => api(`/automation/webhooks/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['webhooks'] }),
    onError: (e) => toast('error', errText(e)),
  });
  return (
    <Panel title="Webhooks" icon={<WebhookIcon className="h-5 w-5" />}>
      {!admin ? (
        <p className="text-sm text-bone-muted">Requires the admin role.</p>
      ) : (
        <>
          {q.data?.length ? (
            <ul className="mb-3 space-y-2">
              {q.data.map((w) => (
                <li key={w.id} className="panel-inset flex items-center gap-2 px-3 py-2 text-sm">
                  <Link2 className="h-4 w-4 text-bone-muted" />
                  <span className="font-medium">{w.name}</span>
                  <span className="num truncate text-xs text-bone-dim">{w.url_redacted}</span>
                  {!w.enabled && <Badge>off</Badge>}
                  <button type="button" className="btn-icon ml-auto h-8 w-8" aria-label={`Delete webhook ${w.name}`} onClick={() => del.mutate(w.id)}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-3 text-sm text-bone-muted">No webhooks yet.</p>
          )}
          <form
            className="grid gap-2 sm:grid-cols-[1fr_2fr]"
            onSubmit={(e) => {
              e.preventDefault();
              add.mutate();
            }}
          >
            <input className="input" placeholder="Name" aria-label="Webhook name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className="input num" type="url" placeholder="https://hooks.example.com/…" aria-label="Webhook URL" required value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
            <input className="input num sm:col-span-2" type="password" autoComplete="off" placeholder="Signing secret (optional, HMAC-SHA256)" aria-label="Signing secret" value={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.value })} />
            <p className="text-xs text-bone-dim sm:col-span-2">HTTPS only. Private and loopback addresses are blocked unless allowlisted on the server.</p>
            <ErrorNote error={add.error} />
            <div className="sm:col-span-2">
              <button type="submit" className="btn btn-primary" disabled={add.isPending}>
                <Plus className="h-4 w-4" /> Add webhook
              </button>
            </div>
          </form>
        </>
      )}
    </Panel>
  );
}

function SummariesPanel() {
  const { can } = useAuth();
  const { channels } = useChannels();
  const pipeline = usePipeline();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['summaries'], queryFn: () => api<Summary[]>('/summaries') });
  const [f, setF] = useState(() => ({ channel_id: '' as number | '', start: toLocalInput(new Date(Date.now() - 3600_000)), end: toLocalInput(new Date()) }));
  const gen = useMutation({
    mutationFn: () => api<Summary>('/summaries', { method: 'POST', body: { channel_id: f.channel_id || null, start: fromLocalInput(f.start), end: fromLocalInput(f.end) } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['summaries'] });
      toast('ok', 'Summary generated');
    },
    onError: (e) => toast('error', errText(e)),
  });
  const ollamaOk = pipeline?.ollama.state === 'running';
  return (
    <Panel title="AI summaries" icon={<Sparkles className="h-5 w-5" />} actions={<Badge tone={ollamaOk ? 'ok' : 'muted'}>Ollama: {serviceLabel(pipeline?.ollama.state)}</Badge>}>
      <p className="mb-3 text-xs text-bone-muted">Ollama reads transcript text and event records for the chosen window — it never hears audio. Summaries cite the lines they used.</p>
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
        <select className="input" aria-label="Summary channel" value={f.channel_id} onChange={(e) => setF({ ...f, channel_id: e.target.value ? Number(e.target.value) : '' })}>
          <option value="">All channels</option>
          {channels?.map((c) => (
            <option key={c.id} value={c.id}>
              {channelLabel(c.slot, c.name)}
            </option>
          ))}
        </select>
        <input type="datetime-local" className="input" aria-label="Summary start" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} />
        <input type="datetime-local" className="input" aria-label="Summary end" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} />
        <Button variant="primary" onClick={() => gen.mutate()} disabled={gen.isPending} disabledReason={!can('operator') ? 'Requires the operator role' : !ollamaOk && 'Ollama is not running'}>
          {gen.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />} Summarize
        </Button>
      </div>
      <ul className="mt-4 space-y-3">
        {q.data?.length === 0 && <Empty title="No summaries yet" />}
        {q.data?.map((s) => (
          <li key={s.id} className="rounded-lg border border-speech/40 bg-speech/5 p-3">
            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
              <Badge tone="speech">
                <Sparkles className="h-3 w-3" /> AI-generated — verify against source evidence
              </Badge>
              <span className="num text-bone-muted">
                {dateTime(s.start)} → {clock(s.end)} · {s.model}
              </span>
            </div>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{s.text}</p>
            {s.citations.length > 0 && (
              <p className="num mt-2 text-[11.5px] text-bone-dim">
                Sources:{' '}
                {s.citations.map((c, i) => (
                  <span key={`${c.kind}-${c.id}`}>
                    {i > 0 && ', '}
                    {c.kind === 'segment' ? 'transcript' : 'event'} #{c.id} @{clock(c.at)}
                  </span>
                ))}
              </p>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
