import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Loader2, Pencil, PlugZap, Radio, RefreshCw, Save, Stethoscope } from 'lucide-react';
import { api } from '../lib/api';
import { live } from '../lib/live';
import type { Channel, ChannelDiagnostics, ChannelTestResult, Transport } from '../lib/types';
import { ago, bytes, channelLabel, dateTime, duration } from '../lib/format';
import { useChannels, useReconnect } from '../hooks/queries';
import { useAuth } from '../hooks/useAuth';
import { errText, useToast } from '../hooks/useToast';
import { Badge, Button, Dialog, Dot, ErrorNote, PageHeader, Panel, Toggle } from '../components/ui';

const tone = (s: Channel['state']) => (s === 'online' ? 'ok' : s === 'connecting' ? 'warn' : s === 'offline' || s === 'error' ? 'bad' : 'muted');

export default function Channels() {
  const { channels, error } = useChannels();
  const { can } = useAuth();
  const [edit, setEdit] = useState<Channel | null>(null);
  const [diag, setDiag] = useState<Channel | null>(null);
  const reconnect = useReconnect();
  const toast = useToast();
  return (
    <div className="space-y-4">
      <PageHeader title="Channels" subtitle="RTSP audio sources. Addresses and passwords stay on the server and are never shown in full." />
      <ErrorNote error={error} />
      <div className="grid gap-3 lg:grid-cols-2">
        {channels?.map((c) => (
          <Panel
            key={c.id}
            title={
              <span className="flex items-center gap-2">
                <Dot tone={tone(c.state)} /> {channelLabel(c.slot, c.name)}
              </span>
            }
            actions={<Badge tone={tone(c.state) === 'muted' ? 'muted' : tone(c.state)}>{c.state}</Badge>}
          >
            <dl className="grid grid-cols-[120px_1fr] gap-y-1 text-sm">
              <dt className="text-bone-muted">Source</dt>
              <dd className="num break-all">{c.url_redacted ?? <span className="text-bone-dim">Not configured</span>}</dd>
              <dt className="text-bone-muted">Transport</dt>
              <dd className="uppercase">{c.transport}</dd>
              <dt className="text-bone-muted">Stream</dt>
              <dd className="num">{[c.codec, c.sample_rate && `${c.sample_rate} Hz`, c.channels && `${c.channels} ch`].filter(Boolean).join(' · ') || '—'}</dd>
              <dt className="text-bone-muted">Last packet</dt>
              <dd className="num">{c.last_packet_at ? ago(c.last_packet_at) : '—'}</dd>
              {c.state_reason && (
                <>
                  <dt className="text-bone-muted">Reason</dt>
                  <dd className="text-warn">{c.state_reason}</dd>
                </>
              )}
              <dt className="text-bone-muted">Processing</dt>
              <dd className="flex flex-wrap gap-1">
                <Badge tone={c.record ? 'ok' : 'muted'}>record {c.record ? 'on' : 'off'}</Badge>
                <Badge tone={c.transcribe ? 'ok' : 'muted'}>transcribe {c.transcribe ? 'on' : 'off'}</Badge>
                <Badge tone={c.classify ? 'ok' : 'muted'}>classify {c.classify ? 'on' : 'off'}</Badge>
              </dd>
            </dl>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button onClick={() => setEdit(c)} disabledReason={!can('admin') && 'Requires the admin role'}>
                <Pencil className="h-4 w-4" /> Edit
              </Button>
              <Button
                onClick={() => reconnect.mutate(c.id, { onSuccess: () => toast('info', 'Reconnect requested'), onError: (e) => toast('error', errText(e)) })}
                disabledReason={!can('operator') ? 'Requires the operator role' : c.state === 'unconfigured' && 'Configure a source first'}
              >
                <RefreshCw className="h-4 w-4" /> Reconnect
              </Button>
              <Button onClick={() => setDiag(c)} disabledReason={!can('operator') && 'Requires the operator role'}>
                <Stethoscope className="h-4 w-4" /> Diagnostics
              </Button>
            </div>
          </Panel>
        ))}
      </div>
      {edit && <EditDialog ch={edit} onClose={() => setEdit(null)} />}
      {diag && <DiagDialog ch={diag} onClose={() => setDiag(null)} />}
    </div>
  );
}

function EditDialog({ ch, onClose }: { ch: Channel; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(ch.name);
  const [url, setUrl] = useState('');
  const [transport, setTransport] = useState<Transport>(ch.transport);
  const [enabled, setEnabled] = useState(ch.enabled);
  const [record, setRecord] = useState(ch.record);
  const [transcribe, setTranscribe] = useState(ch.transcribe);
  const [classify, setClassify] = useState(ch.classify);
  const [test, setTest] = useState<ChannelTestResult | null>(null);

  const save = useMutation({
    mutationFn: () => api<Channel>(`/channels/${ch.id}`, { method: 'PUT', body: { name, transport, enabled, record, transcribe, classify, ...(url ? { url } : {}) } }),
    onSuccess: (c) => {
      live.patchChannel(c);
      void qc.invalidateQueries({ queryKey: ['channels'] });
      toast('ok', 'Channel saved');
      onClose();
    },
  });
  const tester = useMutation({
    mutationFn: () => api<ChannelTestResult>('/channels/test', { method: 'POST', body: url ? { url, transport } : { channel_id: ch.id } }),
    onSuccess: setTest,
  });

  return (
    <Dialog open onClose={onClose} title={`Edit ${channelLabel(ch.slot)}`}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div>
          <label className="label" htmlFor="ch-name">
            Name
          </label>
          <input id="ch-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required />
        </div>
        <div>
          <label className="label" htmlFor="ch-url">
            RTSP URL
          </label>
          <input
            id="ch-url"
            type="password"
            autoComplete="off"
            spellCheck={false}
            className="input num"
            placeholder={ch.url_redacted ? `Current: ${ch.url_redacted} — leave blank to keep` : 'rtsp://user:password@192.168.1.20:554/stream'}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <p className="mt-1 text-xs text-bone-dim">Write-only. Stored encrypted on the server; the browser only ever sees a redacted address.</p>
        </div>
        <div>
          <label className="label" htmlFor="ch-tr">
            Transport
          </label>
          <select id="ch-tr" className="input" value={transport} onChange={(e) => setTransport(e.target.value as Transport)}>
            <option value="tcp">TCP (reliable, recommended)</option>
            <option value="udp">UDP (lower latency, may drop)</option>
            <option value="auto">Auto</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Toggle checked={enabled} onChange={setEnabled} label="Enabled" />
          <Toggle checked={record} onChange={setRecord} label="Record" />
          <Toggle checked={transcribe} onChange={setTranscribe} label="Transcribe" />
          <Toggle checked={classify} onChange={setClassify} label="Classify sounds" />
        </div>
        {test && (
          <div className={`rounded-lg border px-3 py-2 text-sm ${test.ok ? 'border-ok/40 bg-ok/10' : 'border-bad/40 bg-bad/10'}`}>
            {test.ok ? (
              <span className="num">
                Connected · {test.codec ?? '?'} · {test.sample_rate ?? '?'} Hz · {test.channels ?? '?'} ch · {test.latency_ms ?? '?'} ms
              </span>
            ) : (
              <span>Failed: {test.error}</span>
            )}
          </div>
        )}
        <ErrorNote error={save.error ?? tester.error} />
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <Button onClick={() => tester.mutate()} disabled={tester.isPending || (!url && !ch.url_redacted)}>
            {tester.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />} Test connection
          </Button>
          <button type="submit" className="btn btn-primary" disabled={save.isPending}>
            <Save className="h-4 w-4" /> Save channel
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function DiagDialog({ ch, onClose }: { ch: Channel; onClose: () => void }) {
  const d = useQuery({ queryKey: ['diag', ch.id], queryFn: () => api<ChannelDiagnostics>(`/channels/${ch.id}/diagnostics`), refetchInterval: 5000 });
  return (
    <Dialog open onClose={onClose} title={`Diagnostics · ${channelLabel(ch.slot, ch.name)}`} wide>
      <ErrorNote error={d.error} />
      {d.data && (
        <>
          <dl className="num grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div className="panel-inset p-3">
              <dt className="font-sans text-xs text-bone-muted">Decoder</dt>
              <dd className="mt-1 flex items-center gap-1.5">
                <Dot tone={d.data.ffmpeg_running ? 'ok' : 'bad'} /> {d.data.ffmpeg_running ? 'running' : 'stopped'}
              </dd>
            </div>
            <div className="panel-inset p-3">
              <dt className="font-sans text-xs text-bone-muted">Restarts</dt>
              <dd className="mt-1">{d.data.restarts}</dd>
            </div>
            <div className="panel-inset p-3">
              <dt className="font-sans text-xs text-bone-muted">Received</dt>
              <dd className="mt-1">{bytes(d.data.bytes_in)}</dd>
            </div>
            <div className="panel-inset p-3">
              <dt className="font-sans text-xs text-bone-muted">Uptime</dt>
              <dd className="mt-1">{duration(d.data.uptime_s)}</dd>
            </div>
          </dl>
          {d.data.last_error && <p className="mt-3 rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm">Last error: {d.data.last_error}</p>}
          <h3 className="mb-1 mt-4 flex items-center gap-2 text-sm font-semibold">
            <Activity className="h-4 w-4 text-amber" /> State history
          </h3>
          <ul className="panel-inset max-h-64 overflow-auto text-sm">
            {d.data.status_log.length === 0 && <li className="px-3 py-2 text-bone-muted">No state changes recorded.</li>}
            {d.data.status_log.map((s, i) => (
              <li key={i} className="flex gap-3 border-b border-ink-600/60 px-3 py-1.5 last:border-0">
                <span className="num w-40 shrink-0 text-bone-muted">{dateTime(s.at)}</span>
                <Badge tone={tone(s.state) === 'muted' ? 'muted' : tone(s.state)}>{s.state}</Badge>
                <span className="text-bone-muted">{s.reason}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {d.isLoading && (
        <p className="text-sm text-bone-muted">
          <Radio className="mr-1 inline h-4 w-4" /> Loading diagnostics…
        </p>
      )}
    </Dialog>
  );
}
