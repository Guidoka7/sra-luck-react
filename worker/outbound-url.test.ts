import { describe, expect, it } from "vitest";
import { isAllowedPushEndpoint } from "./outbound-url";

describe("Web Push outbound URL", () => {
  it("aceita push services conhecidos", () => {
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(isAllowedPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/abc")).toBe(true);
    expect(isAllowedPushEndpoint("https://web.push.apple.com/Q/abc")).toBe(true);
  });

  it("bloqueia SSRF para localhost, metadata e hosts arbitrários", () => {
    expect(isAllowedPushEndpoint("https://127.0.0.1/internal")).toBe(false);
    expect(isAllowedPushEndpoint("https://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isAllowedPushEndpoint("https://localhost/admin")).toBe(false);
    expect(isAllowedPushEndpoint("https://evil.example/push")).toBe(false);
  });

  it("bloqueia credenciais embutidas, HTTP e portas alternativas", () => {
    expect(isAllowedPushEndpoint("http://fcm.googleapis.com/fcm/send/abc")).toBe(false);
    expect(isAllowedPushEndpoint("https://user:pass@fcm.googleapis.com/fcm/send/abc")).toBe(false);
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com:8443/fcm/send/abc")).toBe(false);
  });
});
