import type { KeyboardTypeOptions } from 'react-native';

import { s } from '../i18n';

export type PromptOptions = {
  title: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  confirmLabel?: string;
  cancelLabel?: string;
};

export type SheetOptions = {
  title?: string;
  options: { label: string; destructive?: boolean }[];
  cancelLabel?: string;
};

export type AlertButton = { label: string; style?: 'cancel' | 'destructive' | 'default' };

export type AlertOptions = {
  title: string;
  message?: string;
  buttons?: AlertButton[];
};

export type HostRequest =
  | { id: number; kind: 'prompt'; opts: PromptOptions; resolve: (v: string | null) => void }
  | { id: number; kind: 'sheet'; opts: SheetOptions; resolve: (v: number | null) => void }
  | { id: number; kind: 'alert'; opts: AlertOptions & { buttons: AlertButton[] }; resolve: (v: number | null) => void };

// The UI (both platforms) lives in <PromptHost/>. One is mounted in the root layout and one in each screen
// presented as a native modal (an RN Modal can't present over a sheet that is already presenting).
// Hosts form a stack: requests go to the top one only.
type HostSetter = (r: HostRequest | null) => void;
const hosts: HostSetter[] = [];
let current: HostRequest | null = null;
let currentHost: HostSetter | null = null;
let seq = 0;

/** Registers a host on top of the stack; returns the function that unregisters it. */
export function registerHost(h: HostSetter): () => void {
  // A request open in another host would be hidden under the new one: cancel it.
  if (current && currentHost) cancelCurrent();
  hosts.push(h);
  return () => {
    const i = hosts.lastIndexOf(h);
    if (i >= 0) hosts.splice(i, 1);
    if (currentHost === h) cancelCurrent();
  };
}

function cancelCurrent() {
  const r = current;
  const h = currentHost;
  current = null;
  currentHost = null;
  h?.(null);
  (r?.resolve as ((v: null) => void) | undefined)?.(null);
}

function present(r: HostRequest) {
  const top = hosts[hosts.length - 1];
  // A newer request replaces an open one (the old one resolves as cancelled).
  cancelCurrent();
  current = r;
  currentHost = top;
  top(r);
}

/** Called by the host once the dialog is gone. */
export function clearCurrent(r: HostRequest) {
  if (current === r) {
    current = null;
    currentHost = null;
  }
}

/** Text prompt: resolves with the typed text, or null if cancelled. */
export function showPrompt(opts: PromptOptions): Promise<string | null> {
  const cancelLabel = opts.cancelLabel ?? s.common.cancel;
  const confirmLabel = opts.confirmLabel ?? s.common.save;
  return new Promise((resolve) => {
    if (!hosts.length) {
      resolve(null);
      return;
    }
    present({ id: ++seq, kind: 'prompt', opts: { ...opts, cancelLabel, confirmLabel }, resolve });
  });
}

/** Action sheet: resolves with the index in `options`, or null if cancelled. */
export function showActionSheet(opts: SheetOptions): Promise<number | null> {
  const cancelLabel = opts.cancelLabel ?? s.common.cancel;
  return new Promise((resolve) => {
    if (!hosts.length) {
      resolve(null);
      return;
    }
    present({ id: ++seq, kind: 'sheet', opts: { ...opts, cancelLabel }, resolve });
  });
}

/** Alert: resolves with the pressed button index; dismissing resolves with the 'cancel' button's index, else null. */
export function showAlert(opts: AlertOptions): Promise<number | null> {
  const buttons = opts.buttons?.length ? opts.buttons : [{ label: s.common.ok }];
  return new Promise((resolve) => {
    if (!hosts.length) {
      resolve(null);
      return;
    }
    present({ id: ++seq, kind: 'alert', opts: { ...opts, buttons }, resolve });
  });
}
