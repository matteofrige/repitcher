import React from 'react';
import { AudioDevice } from '../audioEngine';
import type { UpdateInfo } from '../electron/preload';
import '../styles/Settings.css';
// ── TRIAL START (DISABILITATO — decommentare per riabilitare il periodo di prova) ──
// import { trialDaysLeft, TRIAL_EXPIRY } from '../trial';
// ── TRIAL END ──

interface SettingsProps {
  inputDevices: AudioDevice[];
  outputDevices: AudioDevice[];
  inputId: string;
  outputId: string;
  onInputChange: (id: string) => void;
  onOutputChange: (id: string) => void;
  trayVisible: boolean;
  onTrayVisibleChange: (v: boolean) => void;
  appVersion: string;
  updateInfo: UpdateInfo | null;
  updateStatus: 'idle' | 'checking' | 'uptodate' | 'available' | 'downloading';
  downloadProgress: number;
  onCheckUpdate: () => void;
  onDownloadUpdate: () => void;
}

const Settings: React.FC<SettingsProps> = ({
  inputDevices,
  outputDevices,
  inputId,
  outputId,
  onInputChange,
  onOutputChange,
  trayVisible,
  onTrayVisibleChange,
  appVersion,
  updateInfo,
  updateStatus,
  downloadProgress,
  onCheckUpdate,
  onDownloadUpdate,
}) => {
  const pct = Math.round(downloadProgress * 100);

  return (
    <div className="settings">
      {/* ── TRIAL START (DISABILITATO — decommentare per riabilitare il periodo di prova) ──
      <section className="settings-section settings-trial-section">
        <h2 className="settings-title">License</h2>
        <div className="settings-trial">
          <span className="settings-trial-days">{trialDaysLeft()}</span>
          <span className="settings-trial-label">days left in evaluation</span>
          <span className="settings-trial-expiry">Expires on {TRIAL_EXPIRY.toLocaleDateString()}</span>
        </div>
      </section>
      ── TRIAL END ── */}
      {/* Devices */}
      <section className="settings-section">
        <h2 className="settings-title">Devices</h2>
        <div className="settings-field">
          <label className="settings-label" htmlFor="set-input">
            Microphone (tuner)
          </label>
          <select
            id="set-input"
            className="device-select"
            value={inputId}
            onChange={(e) => onInputChange(e.target.value)}
          >
            <option value="">Default microphone</option>
            {inputDevices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
        <div className="settings-field">
          <label className="settings-label" htmlFor="set-output">
            Output (speakers / headphones)
          </label>
          <select
            id="set-output"
            className="device-select"
            value={outputId}
            onChange={(e) => onOutputChange(e.target.value)}
          >
            {outputDevices.length === 0 && <option value="">No devices</option>}
            {outputDevices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
      </section>

      {/* Menu bar */}
      <section className="settings-section">
        <h2 className="settings-title">Menu bar</h2>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={trayVisible}
            onChange={(e) => onTrayVisibleChange(e.target.checked)}
          />
          <span>Show menu-bar icon</span>
        </label>
      </section>

      {/* Updates */}
      <section className="settings-section">
        <h2 className="settings-title">Updates</h2>
        <div className="settings-update-row">
          <button
            className="settings-btn"
            onClick={onCheckUpdate}
            disabled={updateStatus === 'checking' || updateStatus === 'downloading'}
          >
            {updateStatus === 'checking' ? 'Checking…' : 'Check for updates'}
          </button>
          <span className="settings-update-status">
            {updateStatus === 'uptodate' && "You're up to date ✓"}
            {updateStatus === 'available' && updateInfo && `Available: ${updateInfo.version}`}
          </span>
        </div>

        {updateInfo && (
          <div className="settings-update-detail">
            {updateInfo.notes && <p className="settings-update-notes">{updateInfo.notes}</p>}
            {updateStatus === 'downloading' ? (
              <div className="settings-progress">
                <div className="settings-progress-bar" style={{ width: `${pct}%` }} />
                <span className="settings-progress-label">{pct}%</span>
              </div>
            ) : (
              <button className="settings-btn primary" onClick={onDownloadUpdate}>
                Download &amp; install {updateInfo.version}
              </button>
            )}
          </div>
        )}
      </section>

      {/* App info */}
      <section className="settings-section">
        <h2 className="settings-title">About</h2>
        <div className="settings-about">
          <div className="settings-about-name">RePitch</div>
          <div className="settings-about-sub">Real-time Audio Toolkit</div>
          <div className="settings-about-ver">Version {appVersion || '—'}</div>
        </div>
      </section>
    </div>
  );
};

export default Settings;
