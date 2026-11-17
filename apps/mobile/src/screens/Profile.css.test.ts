import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./Profile.css", import.meta.url), "utf8");
const flat = css.replace(/\s+/g, " ");

/**
 * Owner defect 2026-11-17: the connected-account labels must stay on one line
 * at every width. The first repair gave every Profile row's title priority over
 * its value, which stopped long settings descriptions from shrinking and made
 * the page scroll horizontally at 320dp. These checks keep that exception on
 * the four connected rows and keep the full phone number visible there.
 */
describe("Profile connected-account row layout", () => {
  it("gives the title priority only on the connected rows", () => {
    expect(flat).toMatch(
      /\.fb-profile \.fb-settings-row\.fb-profile-account-row \.fb-settings-row-copy \{ flex: 1 0 auto;/,
    );
    expect(flat).not.toMatch(/\.fb-profile \.fb-settings-row-copy \{ flex: 1 0 auto;/);
  });

  it("keeps the full phone number by dropping the redundant chevron below 340px", () => {
    const narrow = flat.slice(flat.indexOf("@media (max-width: 340px)"));
    expect(narrow).toMatch(
      /\.fb-profile \.fb-settings-row\.fb-profile-account-row \.fb-settings-chevron \{ display: none;/,
    );
  });

  it("keeps connected rows on one line below 480px without hiding the title", () => {
    const phone = flat.slice(flat.indexOf("@media (max-width: 480px)"), flat.indexOf("@media (max-width: 360px)"));
    expect(phone).toMatch(/flex-wrap: nowrap/);
    expect(phone).toMatch(/text-overflow: ellipsis/);
    expect(phone).toMatch(/\.fb-settings-row-title \{ white-space: nowrap;/);
  });
});
