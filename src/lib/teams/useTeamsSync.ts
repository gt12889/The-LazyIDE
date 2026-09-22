// Hosted team authentication and synchronization are absent from lazygt.
export function useTeamsSync(_options: { projectRoot: string }): { triggerResync: () => Promise<void> } {
  return { triggerResync: async () => {} };
}
