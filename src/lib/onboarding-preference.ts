export const onboardingPreferenceKey = (address: string) =>
  `mesh:onboarding:v1:${encodeURIComponent(address)}`;

/** Browser-local preference, with a session fallback when storage is unavailable. */
export function createOnboardingPreferences(
  storage: () => Pick<Storage, "getItem" | "setItem">,
) {
  const session = new Map<string, boolean>();
  return {
    read(address: string): boolean {
      const remembered = session.get(address);
      if (remembered !== undefined) return remembered;
      try {
        return (
          storage().getItem(onboardingPreferenceKey(address)) === "dismissed"
        );
      } catch {
        return false;
      }
    },
    write(address: string, dismissed: boolean) {
      session.set(address, dismissed);
      try {
        storage().setItem(
          onboardingPreferenceKey(address),
          dismissed ? "dismissed" : "visible",
        );
      } catch {
        // Keep the choice for this page lifetime without blocking wallet actions.
      }
    },
  };
}
