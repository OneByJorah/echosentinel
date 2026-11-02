import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AudioLines, ArrowRight, BrainCircuit, FileText, LayoutGrid, Maximize2, Minimize2, Rows3, Volume2 } from 'lucide-react';
import { useChannels, useMetrics, usePipeline, useSeedLive } from '../hooks/queries';
import { useLive } from '../hooks/useLive';
import { ChannelCard } from '../components/ChannelCard';
import { LiveTranscriptPanel } from '../components/Transcript';
import { EventRow } from '../components/Events';
import { TimelinePanel } from '../components/Timeline';
import { SystemStatusCard, StateIcon } from '../components/SystemStatus';
import { Empty, ErrorNote, Panel, Skeleton, Tabs, cx, serviceLabel } from '../components/ui';
import { categoryLabel } from '../lib/format';

type Layout = 'grid' | 'list';

function readLayout(): Layout {
  try {
    return (localStorage.getItem('es.layout') as Layout) || 'grid';
  } catch {
    return 'grid';
  }
}

export default function LiveAudio() {
  useSeedLive();
  const { channels, loading, error } = useChannels();
  const pipeline = usePipeline();
  const metrics = useMetrics();
  const events = useLive((s) => s.events);
  const [layout, setLayout] = useState<Layout>(readLayout);
  const [tab, setTab] = useState<'transcript' | 'ai'>('transcript');
  const [mobileTab, setMobileTab] = useState<'transcript' | 'events'>('transcript');
  const gridRef = useRef<HTMLDivElement>(null);
  const [isFs, setIsFs] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem('es.layout', layout);
    } catch {
      /* storage unavailable */
    }
  }, [layout]);
  useEffect(() => {
    const fn = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', fn);
    return () => document.removeEventListener('fullscreenchange', fn);
  }, []);

  const online = channels?.filter((c) => c.state === 'online').length ?? 0;
  const total = channels?.length ?? 0;
  const chMap = new Map((channels ?? []).map((c) => [c.id, c]));

  const toggleFs = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void gridRef.current?.requestFullscreen?.().catch(() => undefined);
  };

  const recent = events.slice(0, 6);

  const aiPanel = (
    <div className="space-y-2">
      <ul className="panel-inset">
        <li className="flex items-center gap-3 border-b border-ink-600/70 px-3 py-2.5">
          <StateIcon state={pipeline?.classifier.state} />
          <div className="flex-1 text-sm">
            Sound classifier
            <div className="text-[11.5px] text-bone-dim">{pipeline?.classifier.model ?? pipeline?.classifier.engine ?? '—'}</div>
          </div>
          <span className="num text-xs text-bone-muted">{serviceLabel(pipeline?.classifier.state)}</span>
        </li>
        <li className="flex items-center gap-3 px-3 py-2.5">
          <StateIcon state={pipeline?.stt.state} />
          <div className="flex-1 text-sm">
            Speech-to-text
            <div className="text-[11.5px] text-bone-dim">{pipeline?.stt.model ?? pipeline?.stt.engine ?? '—'}</div>
          </div>
          <span className="num text-xs text-bone-muted">{serviceLabel(pipeline?.stt.state)}</span>
        </li>
      </ul>
      {pipeline && pipeline.classifier.state !== 'ready' && (
        <p className="text-xs text-bone-muted">
          No sound events are generated while the classifier is {serviceLabel(pipeline.classifier.state).toLowerCase()}. See <Link className="text-amber underline" to="/system">System</Link>.
        </p>
      )}
      <ul className="max-h-[200px] space-y-1 overflow-auto">
        {Object.entries(
          events.reduce<Record<string, number>>((a, e) => {
            a[e.category] = (a[e.category] ?? 0) + 1;
            return a;
          }, {}),
        ).map(([k, v]) => (
          <li key={k} className="flex justify-between rounded px-2 py-1 text-sm hover:bg-ink-700">
            <span>{categoryLabel(k)}</span>
            <span className="num text-bone-muted">{v}</span>
          </li>
        ))}
      </ul>
    </div>
  );

  const eventsPanel = (
    <Panel
      title="Recent AI Audio Events"
      icon={<AudioLines className="h-5 w-5" />}
      actions={
        <Link to="/events" className="flex items-center gap-1 text-sm font-medium text-amber hover:underline">
          View all <ArrowRight className="h-4 w-4" />
        </Link>
      }
    >
      {recent.length === 0 ? (
        <Empty title="No events yet">{pipeline?.classifier.state === 'ready' ? 'Detected sounds appear here as they happen.' : 'The sound classifier is not running, so no events are produced.'}</Empty>
      ) : (
        <ul className="space-y-2">
          {recent.map((ev) => (
            <EventRow key={ev.id} ev={ev} channel={chMap.get(ev.channel_id)} />
          ))}
        </ul>
      )}
    </Panel>
  );

  return (
    <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_minmax(380px,520px)] xl:grid-cols-[minmax(0,1fr)_400px]">
      {/* Channels */}
      <div ref={gridRef} className={cx('min-w-0', isFs && 'overflow-auto bg-ink p-4')}>
        <Panel
          title={
            <span className="flex flex-col">
              <span className="text-lg">Live Audio Monitor</span>
              <span className="num text-[12.5px] font-normal text-bone-muted">
                {channels ? (
                  <>
                    {total} channels · <span className="text-ok">{online} online</span> · <span className={total - online ? 'text-bad' : ''}>{total - online} offline</span>
                  </>
                ) : (
                  <Skeleton className="h-3 w-40" />
                )}
              </span>
            </span>
          }
          icon={<Volume2 className="h-6 w-6" />}
          actions={
            <>
              <div className="flex rounded-lg border border-ink-600 bg-ink-850 p-0.5" role="group" aria-label="Channel layout">
                <button type="button" aria-pressed={layout === 'grid'} className={cx('rounded-md p-1.5', layout === 'grid' ? 'bg-amber text-ink' : 'text-bone-muted hover:text-bone')} onClick={() => setLayout('grid')} title="2 × 2 grid" aria-label="Grid layout">
                  <LayoutGrid className="h-5 w-5" />
                </button>
                <button type="button" aria-pressed={layout === 'list'} className={cx('rounded-md p-1.5', layout === 'list' ? 'bg-amber text-ink' : 'text-bone-muted hover:text-bone')} onClick={() => setLayout('list')} title="Stacked list" aria-label="List layout">
                  <Rows3 className="h-5 w-5" />
                </button>
              </div>
              <button type="button" className="btn-icon" aria-label={isFs ? 'Exit full screen' : 'Full screen channels'} onClick={toggleFs}>
                {isFs ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
              </button>
            </>
          }
        >
          <ErrorNote error={error} />
          {loading ? (
            <div className="grid gap-3 md:grid-cols-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-[200px] w-full rounded-xl" />
              ))}
            </div>
          ) : (
            <div className={cx('grid gap-3', layout === 'grid' ? 'md:grid-cols-2' : 'grid-cols-1')}>
              {channels?.map((c) => <ChannelCard key={c.id} ch={c} compact={layout === 'list'} />)}
            </div>
          )}
        </Panel>
      </div>

      {/* Right column */}
      <div className="flex min-w-0 flex-col gap-4 xl:row-span-2">
        <Panel className="hidden md:flex">
          <div className="pt-3.5">
            <Tabs
              value={tab}
              onChange={setTab}
              tabs={[
                { id: 'transcript', label: <><FileText className="h-4 w-4" /> Live Transcription</> },
                { id: 'ai', label: <><BrainCircuit className="h-4 w-4" /> AI Recognition</> },
              ]}
            />
            <div className="mt-3">{tab === 'transcript' ? <LiveTranscriptPanel channels={channels ?? []} compact /> : aiPanel}</div>
          </div>
        </Panel>
        {/* Mobile: transcript / events as tabs */}
        <div className="md:hidden">
          <Tabs
            value={mobileTab}
            onChange={setMobileTab}
            tabs={[
              { id: 'transcript', label: 'Transcript' },
              { id: 'events', label: 'Events' },
            ]}
          />
          <div className="mt-3">{mobileTab === 'transcript' ? <Panel><div className="pt-3"><LiveTranscriptPanel channels={channels ?? []} compact /></div></Panel> : eventsPanel}</div>
        </div>
        <div className="hidden md:block">{eventsPanel}</div>
        <div className="hidden xl:block">
          <SystemStatusCard pipeline={pipeline} metrics={metrics} />
        </div>
      </div>

      <div className="min-w-0">{channels && <TimelinePanel channels={channels} />}</div>
      <div className="xl:hidden">
        <SystemStatusCard pipeline={pipeline} metrics={metrics} />
      </div>
    </div>
  );
}
