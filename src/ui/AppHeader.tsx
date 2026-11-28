import type { Stage, View } from '../app/storage';
import type { DeviceStatus } from '../ai/routes';
import { PROMISE } from './Hero';
import { DevicePill } from './pages';

export interface AppHeaderProps {
  landing: boolean;
  view: View;
  setView: (v: View) => void;
  lessonsCount: number;
  receiptsCount: number;
  device: DeviceStatus;
  download: number | null;
  onTurnOnDevice: () => void;
  online: boolean;
  configured: boolean;
  install: (() => void) | null;
  deskCleared: 'ok' | 'signout-failed' | null;
  onRetrySignOut: () => void;
  canClearDesk: boolean;
  onClearDesk: () => void;
  watch?: (() => void) | null;
  stage?: Stage;
}

export function AppHeader({
  landing,
  view,
  setView,
  lessonsCount,
  receiptsCount,
  device,
  download,
  onTurnOnDevice,
  online,
  configured,
  install,
  deskCleared,
  onRetrySignOut,
  canClearDesk,
  onClearDesk,
  watch,
}: AppHeaderProps) {
  return (
    <header className="top">
      <div className="brand">
        <span className="logo" aria-hidden="true" />
        <div>
          <h1>Staffroom</h1>
          {!landing && <p>{PROMISE}</p>}
        </div>
      </div>
      <nav aria-label="Sections">
        <button className={view === 'desk' ? 'tab on' : 'tab'} onClick={() => setView('desk')}>
          Desk
        </button>
        <button className={view === 'lessons' ? 'tab on' : 'tab'} onClick={() => setView('lessons')}>
          Lessons
          <span className={lessonsCount > 0 ? 'count' : 'count none'} aria-hidden={lessonsCount === 0}>
            {lessonsCount}
          </span>
        </button>
        <button className={view === 'receipts' ? 'tab on' : 'tab'} onClick={() => setView('receipts')}>
          Receipts
          {/* The badge keeps its place when there is nothing to count, so the header does not shift when it appears. */}
          <span className={receiptsCount > 0 ? 'count' : 'count none'} aria-hidden={receiptsCount === 0}>
            {receiptsCount}
          </span>
        </button>
        <button className={view === 'how' ? 'tab on' : 'tab'} onClick={() => setView('how')}>
          How it works
        </button>
      </nav>
      <div className="status">
        <DevicePill device={device} download={download} onTurnOn={onTurnOnDevice} onWatch={watch ?? undefined} />
        {/* navigator.onLine says only that this computer has a network. It does not say the cloud model will answer. */}
        {!online && (
          <span className="pill warn">
            <i />
            Network: offline
          </span>
        )}
        {!configured && (
          <span className="pill warn">
            <i />
            Cloud: not connected
          </span>
        )}
        {install && (
          <button className="pill action" onClick={install}>
            Install
          </button>
        )}
        {deskCleared === 'ok' && (
          <span className="pill ok" role="status">
            <i />
            Desk cleared from this browser
          </span>
        )}
        {deskCleared === 'signout-failed' && (
          <span className="pill warn" role="status">
            <i />
            Browser data cleared; sign-out failed — close this browser or{' '}
            <button type="button" className="inline-retry" onClick={onRetrySignOut}>
              Retry sign-out
            </button>
          </span>
        )}
        {canClearDesk && (
          <button
            className="pill action"
            type="button"
            onClick={onClearDesk}
            title="Notes clear when this tab closes unless kept. Click to wipe now and sign out."
          >
            Clear desk
          </button>
        )}
      </div>
    </header>
  );
}
