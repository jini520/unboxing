/**
 * Step 5 (store-prep) — app.json sanity (QA-012, E3).
 *
 * app.json 의 ios.privacyManifests(Privacy Manifest)는 typecheck/jest 가 아니라 **iOS 빌드(expo prebuild)**
 * 에서만 실효 검증된다. 따라서 이 테스트는 정식 검증이 아니라, app.json 이 **유효 JSON**이고 매니페스트의
 * **필수 키 구조가 존재**하는지 가벼운 sanity 만 확인한다(매니페스트 오타·구조 깨짐 회귀 방지).
 * 정식 검증은 iOS 빌드 시점 — docs/QA.md §3-A / QA §3-C.
 */
import { describe, it, expect } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

const raw = readFileSync(join(__dirname, "../../../app.json"), "utf8");

describe("app.json sanity", () => {
  it("유효 JSON 으로 파싱된다", () => {
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  const cfg = JSON.parse(raw);

  it("ios.privacyManifests 가 선언돼 있다", () => {
    const pm = cfg.expo?.ios?.privacyManifests;
    expect(pm).toBeDefined();
    expect(pm.NSPrivacyTracking).toBe(false);
    expect(Array.isArray(pm.NSPrivacyAccessedAPITypes)).toBe(true);
  });

  it("required-reason API 가 카테고리·이유코드 구조를 갖춘다", () => {
    const types = cfg.expo.ios.privacyManifests.NSPrivacyAccessedAPITypes as Array<{
      NSPrivacyAccessedAPIType: string;
      NSPrivacyAccessedAPITypeReasons: string[];
    }>;
    expect(types.length).toBeGreaterThan(0);
    for (const t of types) {
      expect(typeof t.NSPrivacyAccessedAPIType).toBe("string");
      expect(t.NSPrivacyAccessedAPIType).toMatch(/^NSPrivacyAccessedAPICategory/);
      expect(Array.isArray(t.NSPrivacyAccessedAPITypeReasons)).toBe(true);
      expect(t.NSPrivacyAccessedAPITypeReasons.length).toBeGreaterThan(0);
    }
  });
});
