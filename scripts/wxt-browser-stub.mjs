// Stub for bundling extension modules outside WXT (probes in scripts/).
// Just enough surface for module top-level listener registration; probes
// exercise the pure/injected-JS parts, never the real debugger.
const noop = () => {};
export const browser = {
  debugger: {
    onDetach: { addListener: noop },
    onEvent: { addListener: noop },
    attach: noop,
    detach: noop,
    sendCommand: noop,
  },
};
