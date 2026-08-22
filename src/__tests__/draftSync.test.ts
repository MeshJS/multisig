import { describe, expect, it } from "@jest/globals";

import { decideDraftSync } from "@/lib/documents/draft-sync";

/**
 * The failure mode this guards against is silent data loss, so every branch is
 * pinned — especially the two that would destroy work: adopting the server's
 * copy over unsaved edits, and rolling an author backwards on a stale poll.
 */
describe("decideDraftSync", () => {
  it("adopts on first load", () => {
    expect(
      decideDraftSync({ baseRevision: null, dirty: false, remoteRevision: 3 }),
    ).toBe("adopt");
  });

  it("adopts on first load even mid-typing — there is no base to conflict with", () => {
    expect(
      decideDraftSync({ baseRevision: null, dirty: true, remoteRevision: 3 }),
    ).toBe("adopt");
  });

  it("does nothing when there is no draft on the server", () => {
    expect(
      decideDraftSync({
        baseRevision: null,
        dirty: false,
        remoteRevision: null,
      }),
    ).toBe("ignore");
  });

  it("follows a newer revision while nothing is unsaved", () => {
    expect(
      decideDraftSync({ baseRevision: 4, dirty: false, remoteRevision: 5 }),
    ).toBe("adopt");
  });

  it("refuses to overwrite unsaved edits", () => {
    expect(
      decideDraftSync({ baseRevision: 4, dirty: true, remoteRevision: 5 }),
    ).toBe("conflict");
  });

  it("ignores its own revision echoed back", () => {
    expect(
      decideDraftSync({ baseRevision: 5, dirty: false, remoteRevision: 5 }),
    ).toBe("ignore");
  });

  it("never rolls the author back on a stale poll", () => {
    // A poll issued before our save can answer after it. Adopting that older
    // body would silently undo what was just written.
    expect(
      decideDraftSync({ baseRevision: 6, dirty: false, remoteRevision: 5 }),
    ).toBe("ignore");
    expect(
      decideDraftSync({ baseRevision: 6, dirty: true, remoteRevision: 5 }),
    ).toBe("ignore");
  });
});
