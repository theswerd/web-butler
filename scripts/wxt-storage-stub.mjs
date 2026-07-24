// In-memory stand-in for `wxt/utils/storage`, for bundling extension
// modules outside WXT in test probes. Only the surface lib/server.ts
// touches: defineItem → { getValue, setValue }.
export const storage = {
  defineItem(_key, opts = {}) {
    let value = opts.fallback ?? null;
    return {
      getValue: async () => value,
      setValue: async (next) => {
        value = next;
      },
    };
  },
};
