import React from 'react';
import { TRIAL_EXPIRY } from '../trial';
import '../styles/TrialLock.css';

/** Schermata di blocco mostrata quando il periodo di prova è scaduto. */
const TrialLock: React.FC = () => (
  <div className="trial-lock">
    <div className="trial-lock-card">
      <div className="trial-lock-icon">🔒</div>
      <h1 className="trial-lock-title">Evaluation period ended</h1>
      <p className="trial-lock-text">
        This evaluation version of RePitch expired on {TRIAL_EXPIRY.toLocaleDateString()}.
        A licensed version with a serial number will be available soon.
      </p>
    </div>
  </div>
);

export default TrialLock;
