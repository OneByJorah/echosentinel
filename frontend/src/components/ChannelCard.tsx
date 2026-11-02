import { Headphones, Link2, Loader2, Mic, MicOff, RefreshCw, Settings2, Volume2, VolumeX, CircleDot, AlertTriangle, Power } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Channel } from '../lib/types';
import { ago, channelLabel, until } from '../lib/format';
import { useNow } from '../hooks/useLive';
import { useListener } from '../hooks/useListener';
import { useReconnect } from '../hooks/queries';
import { useAuth } from '../hooks/useAuth';
import { errText, useToast } from '../hooks/useToast';
import { LiveWaveform } from './Waveform';
import { Badge, Dot, cx, roleTip } from './cardUtil';

const STATE_META: Record<Channel['state'], { label: string; tone: 'ok' | 'bad' | 'warn' | 'muted' }> = {
  online: { label: 'LIVE', tone: 'ok' },
  connecting: { label: 'CONNECTING', tone: 'warn' },
  offline: { label: 'OFFLINE', tone: 'bad' },
  error: { label: 'ERROR', tone: 'bad' },
  disabled: { label: 'DISABLED', tone: 'muted' },
  unconfigured: { label: 'NOT SET UP', tone: 'muted' },
};

export function ChannelCard({ ch, compact }: { ch: Channel; compact?: boolean }) {
  const now = useNow(1000);
  const { can } = useAuth();
  const toast = useToast();
  const reconnect = useReconnect();
  const listen = useListener(ch.id);
  const meta = STATE_META[ch.state];
  const online = ch.state === 'online';
  const retry = until(ch.retry_at, now);

  const doReconnect = () =>
    reconnect.mutate(ch.id, {
      onSuccess: () => toast('info', `Reconnecting ${channelLabel(ch.slot)}…`),
      onError: (e) => toast('error', errText(e)),
    });

  return (
    <article
      aria-label={`${channelLabel(ch.slot, ch.name)}, ${meta.label.toLowerCase()}`}
      className={cx(
        'relative flex min-w-0 flex-col rounded-xl border bg-ink-800 p-3.5 transition-shadow',
        online ? 'border-amber shadow-live' : 'border-ink-600',
        compact ? 'min-h-[150px]' : 'min-h-[200px]',
      )}
    >
      <header className="flex items-center gap-2">
        <Dot tone={meta.tone} pulse={ch.state === 'connecting'} />
        <h3 className="min-w-0 flex-1 truncate text-[15px] font-semibold">
          <span className="num">CH{String(ch.slot).padStart(2, '0')}</span> – {ch.name}
        </h3>
        {ch.demo && <Badge tone="amber">DEMO</Badge>}
        {ch.recording && (
          <span className="flex items-center gap-1 text-[11px] font-semibold text-bad" title="Recording to disk">
            <CircleDot className="h-3.5 w-3.5 animate-live" /> REC
          </span>
        )}
        <span className={cx('chip px-2 py-1 text-[11px]', online ? 'bg-bad text-white' : meta.tone === 'warn' ? 'bg-warn/15 text-warn' : meta.tone === 'bad' ? 'bg-bad/15 text-bad' : 'bg-ink-600 text-bone-muted')}>{meta.label}</span>
      </header>

      <div className="flex flex-1 flex-col justify-center py-2">
        {online ? (
          <LiveWaveform channelId={ch.id} active={online} height={compact ? 64 : 96} />
        ) : (
          <div className="flex flex-col items-center gap-1 py-1 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full border border-ink-500 bg-ink-850 text-bone-dim">
              {ch.state === 'connecting' ? <Loader2 className="h-6 w-6 animate-spin text-warn" /> : ch.state === 'error' ? <AlertTriangle className="h-6 w-6 text-bad" /> : ch.state === 'disabled' ? <Power className="h-6 w-6" /> : <MicOff className="h-6 w-6" />}
            </span>
            <p className="text-base font-semibold tracking-wide">{ch.state === 'unconfigured' ? 'No source configured' : ch.state === 'disabled' ? 'Disabled' : ch.state === 'connecting' ? 'Connecting…' : meta.label === 'ERROR' ? 'Stream error' : 'OFFLINE'}</p>
            <p className="max-w-[90%] truncate text-xs text-bone-muted" title={ch.state_reason ?? undefined}>
              {ch.state_reason ?? (ch.state === 'unconfigured' ? 'Add an RTSP URL in Channels' : 'No stream')}
            </p>
            {(ch.state === 'offline' || ch.state === 'error' || ch.state === 'connecting') && (
              <p className="num text-[11.5px] text-bone-dim">
                Last seen {ago(ch.last_seen_at, now)}
                {retry && ch.state !== 'connecting' ? ` · retry ${retry}${ch.retry_attempt ? ` (#${ch.retry_attempt})` : ''}` : ''}
              </p>
            )}
          </div>
        )}
      </div>

      <footer className="flex flex-wrap items-center gap-2 border-t border-ink-600/70 pt-2.5">
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-bone-muted">
          {online ? <Mic className="h-4 w-4 shrink-0" /> : <Link2 className="h-4 w-4 shrink-0" />}
          <span className="min-w-0 leading-tight">
            <span className="block">RTSP (Audio){ch.transport !== 'auto' ? ` · ${ch.transport.toUpperCase()}` : ''}</span>
            {online && (
              <span className="num block text-bone-dim">
                {[ch.codec?.toUpperCase(), ch.sample_rate ? `${(ch.sample_rate / 1000).toFixed(ch.sample_rate % 1000 ? 1 : 0)} kHz` : null, ch.latency_ms !== null ? `${ch.latency_ms} ms` : null].filter(Boolean).join(' · ') || 'Codec unknown'}
              </span>
            )}
          </span>
        </span>
        {ch.events_today > 0 && (
          <span className="num rounded-md bg-ink-700 px-1.5 py-0.5 text-[11px] text-bone-muted" title="Events detected today">
            {ch.events_today} events
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {online ? (
            <>
              <button
                type="button"
                className={cx('btn px-2.5 py-1 text-xs', listen.listening && 'border-amber text-amber')}
                aria-pressed={listen.listening}
                onClick={() => (listen.listening ? listen.stop() : void listen.start())}
                title={listen.listening ? 'Stop listening' : 'Listen live (audio starts after your click)'}
              >
                {listen.state === 'connecting' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Headphones className="h-3.5 w-3.5" />}
                {listen.listening ? 'Stop' : 'Listen'}
              </button>
              <button type="button" className="btn-icon h-8 w-8" aria-label={listen.muted ? 'Unmute' : 'Mute'} aria-pressed={listen.muted} onClick={() => listen.setMuted(!listen.muted)}>
                {listen.muted || listen.volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </button>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(listen.volume * 100)}
                onChange={(e) => listen.setVolume(Number(e.target.value) / 100)}
                aria-label={`Volume for ${channelLabel(ch.slot)}`}
                className="hidden w-20 accent-amber sm:block"
              />
              <span className="num hidden w-9 text-right text-xs text-bone-muted sm:inline">{Math.round(listen.volume * 100)}%</span>
            </>
          ) : ch.state === 'unconfigured' || ch.state === 'disabled' ? (
            <Link to="/channels" className="btn px-2.5 py-1 text-xs">
              <Settings2 className="h-3.5 w-3.5" /> Configure
            </Link>
          ) : (
            <span title={roleTip(can('operator'), 'operator')} className="inline-flex">
              <button type="button" className="btn px-2.5 py-1 text-xs" disabled={!can('operator') || reconnect.isPending} onClick={doReconnect}>
                <RefreshCw className={cx('h-3.5 w-3.5 text-amber', reconnect.isPending && 'animate-spin')} /> Reconnect
              </button>
            </span>
          )}
        </div>
      </footer>
      {listen.state === 'error' && listen.detail && <p className="mt-2 text-xs text-bad">{listen.detail}</p>}
    </article>
  );
}
