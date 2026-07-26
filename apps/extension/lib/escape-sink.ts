/**
 * The shell's claim on the Escape key, shared between the content script's
 * document_start listener (which must exist before any page script so it
 * can absorb Esc ahead of the site's own capture-phase handlers) and the
 * App (which owns the actual close-priority flow and plugs it in here once
 * it mounts).
 *
 * Contract: while the shell is OPEN, a bare Esc belongs to Web Butler —
 * the page never sees it (no exiting fullscreen, no site modals closing
 * underneath ours). While collapsed, the sink declines and Esc flows to
 * the page untouched.
 */
export const escapeSink = {
  /**
   * Handle a bare-Escape keydown. Returns true when the shell consumed it
   * (the listener then cancels the event for the page). Null until the App
   * mounts — and again after it unmounts.
   */
  onEscape: null as (() => boolean) | null,
  /**
   * The live shell host element. Reload/update leaves the previous build's
   * content script running as a zombie with stale listeners; its host gets
   * torn out of the DOM by the replacement, so requiring a CONNECTED host
   * keeps a zombie's sink from eating Esc forever (its stopImmediate-
   * Propagation would also silence the live build's listener).
   */
  host: null as Element | null,
};
