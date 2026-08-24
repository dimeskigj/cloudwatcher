import { describe, expect, it } from "vitest";
// @ts-expect-error The release CLI is an executable .mjs module without a declaration file.
import { nextReleaseVersion } from "./release-version.mjs";

describe("nextReleaseVersion", () => {
  it("does not release when commits have no release type", () => {
    expect(nextReleaseVersion("0.1.0", ["docs: clarify manual testing"])).toBeNull();
  });

  it("increments the patch version for fixes", () => {
    expect(nextReleaseVersion("1.2.3", ["fix: preserve notice dismissal"])).toBe("1.2.4");
  });

  it("increments the minor version for features", () => {
    expect(nextReleaseVersion("1.2.3", ["feat(options): add range import"])).toBe("1.3.0");
  });

  it("prioritizes breaking changes", () => {
    expect(
      nextReleaseVersion("1.2.3", [
        "fix: correct icon sizing",
        "feat!: replace the warning protocol\n\nBREAKING CHANGE: messages changed",
      ]),
    ).toBe("2.0.0");
  });
});
