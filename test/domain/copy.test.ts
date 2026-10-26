import { describe, expect, test } from "vite-plus/test";
import { copy } from "@/domain/shared/copy";
import { CHECKS, CHECK_KINDS, DOCUMENT_TYPE_NAMES } from "@/domain/shared/checks";

// A07: the domain's user-facing text lives in shared/copy.ts, so the domain
// and the web read the same words. These pin the wording itself through the
// public CHECKS surface; type-checked keys (Record<CheckKind, string> and
// friends at the call sites) are what make a missing key a compile error.

describe("shared copy", () => {
  test("says every check's name, file parts, and hint", () => {
    expect(CHECKS.identity.files.map((part) => part.label)).toEqual([
      "The identity document (front, and back if it has one)",
      "A selfie holding it",
    ]);
    expect(CHECKS["work-photos"].files[0]!.label).toBe("Three photos");
    expect(CHECKS["business-insurance"].hint).toContain("expiry date");
    for (const kind of CHECK_KINDS) expect(CHECKS[kind].name).toBeTruthy();
  });

  test("names the identity document types", () => {
    expect(DOCUMENT_TYPE_NAMES.passport).toBe("Passport");
  });

  test("keeps the email code subjects", () => {
    expect(copy.email.codeSubject["sign-in"]).toBe("Your ArtisanConnect sign-in code");
  });
});
