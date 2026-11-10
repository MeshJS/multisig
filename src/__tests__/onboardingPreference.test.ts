import { describe, it, expect } from "@jest/globals";
import {
  createOnboardingPreferences,
  onboardingPreferenceKey,
} from "@/lib/onboarding-preference";

describe("onboarding preference", () => {
  it("isolates identities, persists dismissal, and restores across reloads", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
    const first = createOnboardingPreferences(() => storage);
    expect(first.read("alice")).toBe(false);
    first.write("alice", true);
    expect(first.read("bob")).toBe(false);
    const reloaded = createOnboardingPreferences(() => storage);
    expect(reloaded.read("alice")).toBe(true);
    reloaded.write("alice", false);
    expect(createOnboardingPreferences(() => storage).read("alice")).toBe(
      false,
    );
    expect(values.get(onboardingPreferenceKey("alice"))).toBe("visible");
  });
  it("handles inaccessible storage without blocking dismissal or reopening", () => {
    const preferences = createOnboardingPreferences(() => {
      throw new Error("Storage blocked");
    });
    expect(preferences.read("alice")).toBe(false);
    preferences.write("alice", true);
    expect(preferences.read("alice")).toBe(true);
    expect(preferences.read("bob")).toBe(false);
    preferences.write("alice", false);
    expect(preferences.read("alice")).toBe(false);
  });
  it("keeps the session choice when writes fail and ignores unknown stored values", () => {
    const preferences = createOnboardingPreferences(() => ({
      getItem: () => "invalid",
      setItem: () => {
        throw new Error("Quota exceeded");
      },
    }));
    expect(preferences.read("alice")).toBe(false);
    preferences.write("alice", true);
    expect(preferences.read("alice")).toBe(true);
  });
});
