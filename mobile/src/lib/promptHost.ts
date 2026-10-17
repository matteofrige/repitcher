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

// The UI (both platforms) lives in <PromptHost/>, mounted once in the root layout; it registers here.
let handler: ((r: HostRequest | null) => void) | null = null;
let current: HostRequest | null = null;
let seq = 0;

export function registerHost(h: ((r: HostRequest | null) => void) | null) {
  handler = h;
}

function present(r: HostRequest) {
  // A newer request replaces an open one (the old one resolves as cancelled).
  (current?.resolve as ((v: null) => void) | undefined)?.(null);
  current = r;
  handler?.(r);
}

/** Called by the host once the dialog is gone. */
export function clearCurrent(r: HostRequest) {
  if (current === r) current = null;
}

/** Text prompt: resolves with the typed text, or null if cancelled. */
export function showPrompt(opts: PromptOptions): Promise<string | null> {
  const cancelLabel = opts.cancelLabel ?? s.common.cancel;
  const confirmLabel = opts.confirmLabel ?? s.common.save;
  return new Promise((resolve) => {
    if (!handler) {
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
    if (!handler) {
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
    if (!handler) {
      resolve(null);
      return;
    }
    present({ id: ++seq, kind: 'alert', opts: { ...opts, buttons }, resolve });
  });
}
