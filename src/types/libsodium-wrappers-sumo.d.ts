declare module "libsodium-wrappers-sumo" {
  export const ready: Promise<void>;

  // The library exposes many functions; we only need `ready` typed here.
  // Keep the rest loosely typed to avoid maintaining the full surface area.
  const sodium: Record<string, any>;
  export default sodium;
}

