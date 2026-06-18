import { describe, it, expect } from "vitest";
import APP_REGISTRY, {
  getAppDefinition,
  DESKTOP_ICON_APPS,
  START_MENU_APPS,
} from "./registry.js";
import { t } from "../../i18n/strings.js";

// Unit tests for the App_Definition registry (Task 6.2).
// Verifies the registry matches the design's registry table and that titles /
// pdfUrls are derived from the single content source (content.json).

const EXPECTED_IDS = [
  "main",
  "chat",
  "pdf-overseas",
  "pdf-fastgpt",
  "pdf-m365",
  "notepad",
  "deco-mycomputer",
  "deco-mydocuments",
  "deco-controlpanel",
  "help",
];

describe("App_Definition registry", () => {
  it("exports exactly the 10 designed app definitions in order", () => {
    expect(APP_REGISTRY.map((a) => a.id)).toEqual(EXPECTED_IDS);
  });

  it("every entry includes all required fields with correct types", () => {
    for (const app of APP_REGISTRY) {
      expect(typeof app.id).toBe("string");
      expect(typeof app.titleKey).toBe("string");
      expect(typeof app.icon).toBe("string");
      expect(app.singleInstance).toBe(true); // all windows are single-instance (Req 7.3)
      expect(typeof app.resizable).toBe("boolean");
      expect(typeof app.maximizable).toBe("boolean");
      expect(app.defaultSize).toEqual({
        w: expect.any(Number),
        h: expect.any(Number),
      });
      expect(app.minSize).toEqual({
        w: expect.any(Number),
        h: expect.any(Number),
      });
      expect(typeof app.content.kind).toBe("string");
      expect(typeof app.launch).toBe("object");
      expect(typeof app.mobile.behavior).toBe("string");
      // default size must be >= min size
      expect(app.defaultSize.w).toBeGreaterThanOrEqual(app.minSize.w);
      expect(app.defaultSize.h).toBeGreaterThanOrEqual(app.minSize.h);
    }
  });

  it("matches the design registry table for resizable/maximizable/launch/mobile", () => {
    const row = (id) => getAppDefinition(id);

    // main: fixed-size, no maximize, desktop icon, start-menu left, fullscreen mobile
    expect(row("main").resizable).toBe(false);
    expect(row("main").maximizable).toBe(false);
    expect(row("main").launch.desktopIcon).toBe(true);
    expect(row("main").launch.startMenu).toBe("left");
    expect(row("main").mobile.behavior).toBe("fullscreen");

    // chat: resizable, maximizable, desktop icon, not in start menu, dialog mobile
    expect(row("chat").resizable).toBe(true);
    expect(row("chat").maximizable).toBe(true);
    expect(row("chat").launch.startMenu).toBe(null);
    expect(row("chat").mobile.behavior).toBe("dialog");

    // pdf windows: resizable, maximizable, start-menu left, newtab mobile
    for (const id of ["pdf-overseas", "pdf-fastgpt", "pdf-m365"]) {
      expect(row(id).content.kind).toBe("pdf-iframe");
      expect(row(id).resizable).toBe(true);
      expect(row(id).launch.startMenu).toBe("left");
      expect(row(id).mobile.behavior).toBe("newtab");
      expect(row(id).content.pdfUrl).toMatch(/^\/pdf\/.+\.pdf$/);
    }

    // notepad: dialog mobile, start-menu left
    expect(row("notepad").content.kind).toBe("notepad");
    expect(row("notepad").mobile.behavior).toBe("dialog");

    // decorative windows: no desktop icon, start-menu right, unavailable mobile
    for (const id of ["deco-mycomputer", "deco-mydocuments", "deco-controlpanel"]) {
      expect(row(id).content.kind).toBe("decorative");
      expect(row(id).launch.desktopIcon).toBe(false);
      expect(row(id).launch.startMenu).toBe("right");
      expect(row(id).mobile.behavior).toBe("unavailable");
      expect(typeof row(id).content.decoType).toBe("string");
    }
  });

  it("derives pdf urls from content.json product entries", () => {
    expect(getAppDefinition("pdf-overseas").content.pdfUrl).toBe(
      "/pdf/apihub-overseas-llm-relay.pdf"
    );
    expect(getAppDefinition("pdf-fastgpt").content.pdfUrl).toBe(
      "/pdf/fastgpt-commercial.pdf"
    );
    expect(getAppDefinition("pdf-m365").content.pdfUrl).toBe(
      "/pdf/microsoft365-copilot.pdf"
    );
  });

  it("uses titleKeys that resolve to bilingual strings", () => {
    for (const app of APP_REGISTRY) {
      const zh = t("zh", app.titleKey);
      const en = t("en", app.titleKey);
      // a resolved key must not equal the raw key (which is the i18n fallback)
      expect(zh).not.toBe(app.titleKey);
      expect(en).not.toBe(app.titleKey);
      expect(zh.length).toBeGreaterThan(0);
      expect(en.length).toBeGreaterThan(0);
    }
  });

  it("desktop icon list is data-driven from content.desktop.icons", () => {
    expect(DESKTOP_ICON_APPS.map((a) => a.id)).toEqual([
      "main",
      "pdf-overseas",
      "pdf-fastgpt",
      "pdf-m365",
      "chat",
      "notepad",
    ]);
  });

  it("groups start menu apps into left and right columns", () => {
    expect(START_MENU_APPS.left.map((a) => a.id)).toEqual([
      "main",
      "pdf-overseas",
      "pdf-fastgpt",
      "pdf-m365",
      "notepad",
    ]);
    expect(START_MENU_APPS.right.map((a) => a.id)).toEqual([
      "deco-mycomputer",
      "deco-mydocuments",
      "deco-controlpanel",
    ]);
  });
});
