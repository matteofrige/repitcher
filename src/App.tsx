import React, { useEffect, useState } from 'react';
import { audioEngine, AudioDevice } from './audioEngine';
import { metronomeEngine } from './metronomeEngine';
import type { UpdateInfo } from './electron/preload';
import PitchShifter from './components/PitchShifter';
import Tuner from './components/Tuner';
import Metronome from './components/Metronome';
import Settings from './components/Settings';
import './styles/App.css';
// ── TRIAL START (rimuovere col serial) ──
import TrialLock from './components/TrialLock';
import { isTrialExpired } from './trial';
// ── TRIAL END ──

type Tab = 'pitch' | 'tuner' | 'metronome' | 'settings';

const TABS: { id: Tab; label: string }[] = [
  { id: 'pitch', label: 'Pitch Shifter' },
  { id: 'tuner', label: 'Tuner' },
  { id: 'metronome', label: 'Metronome' },
  { id: 'settings', label: 'Settings' },
];

export type UpdateStatus = 'idle' | 'checking' | 'uptodate' | 'available' | 'downloading';

interface RePitchWin {
  repitch?: {
    getPlatform: () => Promise<{ appVersion: string }>;
    setTrayVisible: (v: boolean) => void;
    checkUpdate: () => Promise<UpdateInfo | null>;
    downloadUpdate: (url: string) => Promise<string>;
    onUpdateAvailable: (cb: (info: UpdateInfo) => void) => () => void;
    onUpdateProgress: (cb: (p: number) => void) => () => void;
  };
}
const rp = (): RePitchWin['repitch'] => (window as unknown as RePitchWin).repitch;

const App: React.FC = () => {
  const [tab, setTab] = useState<Tab>('pitch');
  // ── TRIAL START (rimuovere col serial) ──
  const [trialExpired, setTrialExpired] = useState(() => isTrialExpired());
  useEffect(() => {
    const id = setInterval(() => setTrialExpired(isTrialExpired()), 60 * 60 * 1000);
    return () => clearInterval(id);
  }, []);
  // ── TRIAL END ──
  const [inputDevices, setInputDevices] = useState<AudioDevice[]>([]);
  const [outputDevices, setOutputDevices] = useState<AudioDevice[]>([]);
  const [inputId, setInputId] = useState<string>(''); // '' = system default mic
  const [outputId, setOutputId] = useState<string>('');
  const [flashEnabled, setFlashEnabled] = useState(false);
  const [flash, setFlash] = useState<{ key: number; accent: boolean }>({ key: 0, accent: false });

  const [appVersion, setAppVersion] = useState('');
  const [trayVisible, setTrayVisible] = useState<boolean>(() => {
    const v = localStorage.getItem('repitch.trayVisible');
    return v === null ? true : v === 'true';
  });
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>('idle');
  const [downloadProgress, setDownloadProgress] = useState(0);

  // Enumerate devices + read app version once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [ins, outs, physical] = await Promise.all([
          audioEngine.listInputDevices(),
          audioEngine.listOutputDevices(),
          audioEngine.findPhysicalOutputDevice(),
        ]);
        if (cancelled) return;
        setInputDevices(ins);
        setOutputDevices(outs);

        // Restore the saved input device (if still present), else system default.
        const savedIn = localStorage.getItem('repitch.inputId') ?? '';
        setInputId(savedIn && ins.some((d) => d.deviceId === savedIn) ? savedIn : '');

        // Restore the saved output device (if still present), else a physical one.
        const savedOut = localStorage.getItem('repitch.outputId') ?? '';
        const chosenOut =
          savedOut && outs.some((d) => d.deviceId === savedOut)
            ? savedOut
            : physical?.deviceId ?? outs[0]?.deviceId ?? '';
        if (chosenOut) {
          setOutputId(chosenOut);
          void audioEngine.setOutputDevice(chosenOut);
          metronomeEngine.setOutputDevice(chosenOut);
        }
      } catch {
        /* ignore */
      }
    })();
    rp()
      ?.getPlatform()
      .then((p) => {
        if (!cancelled) setAppVersion(p.appVersion);
      })
      .catch(() => {
        /* ignore */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Apply the saved tray-visibility preference once, and subscribe to updates.
  useEffect(() => {
    rp()?.setTrayVisible(trayVisible);
    const offAvail = rp()?.onUpdateAvailable?.((info) => {
      setUpdateInfo(info);
      setUpdateStatus('available');
    });
    const offProg = rp()?.onUpdateProgress?.((p) => setDownloadProgress(p));
    return () => {
      offAvail?.();
      offProg?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleInputChange = (id: string) => {
    setInputId(id);
    localStorage.setItem('repitch.inputId', id);
  };

  const handleOutputChange = (id: string) => {
    setOutputId(id);
    localStorage.setItem('repitch.outputId', id);
    void audioEngine.setOutputDevice(id);
    metronomeEngine.setOutputDevice(id);
  };

  const handleTrayVisibleChange = (v: boolean) => {
    setTrayVisible(v);
    localStorage.setItem('repitch.trayVisible', String(v));
    rp()?.setTrayVisible(v);
  };

  const handleCheckUpdate = async () => {
    setUpdateStatus('checking');
    try {
      const info = (await rp()?.checkUpdate()) ?? null;
      if (info) {
        setUpdateInfo(info);
        setUpdateStatus('available');
      } else {
        setUpdateInfo(null);
        setUpdateStatus('uptodate');
      }
    } catch {
      setUpdateStatus('uptodate');
    }
  };

  const handleDownloadUpdate = async () => {
    if (!updateInfo) return;
    setUpdateStatus('downloading');
    setDownloadProgress(0);
    try {
      await rp()?.downloadUpdate(updateInfo.url);
    } catch {
      /* ignore */
    }
    setUpdateStatus('available');
  };

  // Flash the whole window on each metronome beat when enabled.
  useEffect(() => {
    if (!flashEnabled) return;
    let k = 0;
    const unsub = metronomeEngine.onBeat((_beat, isAccent) => {
      k += 1;
      setFlash({ key: k, accent: isAccent });
    });
    return unsub;
  }, [flashEnabled]);

  // ── TRIAL START (rimuovere col serial) ──
  if (trialExpired) {
    return (
      <div className="app">
        <TrialLock />
      </div>
    );
  }
  // ── TRIAL END ──

  return (
    <div className="app">
      {flashEnabled && flash.key > 0 && (
        <div key={flash.key} className={`beat-flash ${flash.accent ? 'accent' : ''}`} />
      )}
      <div className="app-container app-container--wide">
        <header className="app-header">
          <h1 className="app-title">RePitch</h1>
          <p className="app-subtitle">Real-time Audio Toolkit</p>
        </header>

        {updateInfo && (
          <div className="update-banner">
            <span className="update-banner-text">Update {updateInfo.version} available</span>
            {updateStatus === 'downloading' ? (
              <span className="update-banner-progress">{Math.round(downloadProgress * 100)}%</span>
            ) : (
              <button className="update-banner-btn" onClick={handleDownloadUpdate}>
                Download &amp; install
              </button>
            )}
          </div>
        )}

        <nav className="tab-bar">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`tab ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {tab === 'pitch' && <PitchShifter />}
        {tab === 'tuner' && <Tuner inputDeviceId={inputId || undefined} />}
        {tab === 'metronome' && (
          <Metronome flashEnabled={flashEnabled} onFlashToggle={setFlashEnabled} />
        )}
        {tab === 'settings' && (
          <Settings
            inputDevices={inputDevices}
            outputDevices={outputDevices}
            inputId={inputId}
            outputId={outputId}
            onInputChange={handleInputChange}
            onOutputChange={handleOutputChange}
            trayVisible={trayVisible}
            onTrayVisibleChange={handleTrayVisibleChange}
            appVersion={appVersion}
            updateInfo={updateInfo}
            updateStatus={updateStatus}
            downloadProgress={downloadProgress}
            onCheckUpdate={handleCheckUpdate}
            onDownloadUpdate={handleDownloadUpdate}
          />
        )}
      </div>
    </div>
  );
};

export default App;
