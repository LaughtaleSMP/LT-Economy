// ui_close.js — Sentinel untuk close UI langsung dari level manapun
// Throw UIClose saat r.canceled, catch di top-level entry point.
export class UIClose {
  constructor() { this.isUIClose = true; }
}
export function throwIfCanceled(res) {
  if (res.canceled) throw new UIClose();
}
