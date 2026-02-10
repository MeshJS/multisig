let sodiumReadyPromise: Promise<void> | null = null;

export const ensureSodiumReady = async () => {
  if (typeof window === "undefined") {
    return;
  }

  if (!sodiumReadyPromise) {
    sodiumReadyPromise = import("libsodium-wrappers-sumo").then((sodium) =>
      sodium.ready.then(() => undefined),
    );
  }

  await sodiumReadyPromise;
};
