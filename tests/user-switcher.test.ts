import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UserSwitcher } from "@/components/user-switcher";

describe("user switcher", () => {
  it("is a plain form, so a click before hydration still signs in and re-renders the page", () => {
    const html = renderToStaticMarkup(
      createElement(UserSwitcher, { users: [{ id: "u_ana", name: "Ana Ruiz", role: "analyst" }], currentId: null }),
    );
    expect(html).toMatch(/^<form[^>]*>/);
    const button = /<button[^>]*>/.exec(html)?.[0] ?? "";
    expect(button).toContain('type="submit"');
    expect(button).toContain('name="userId"');
    expect(button).toContain('value="u_ana"');
  });
});
