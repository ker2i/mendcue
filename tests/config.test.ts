import { describe, it, expect } from "vitest";
import { readConfig } from "../src/config.js";

describe("shared startup policy", () => {
  it.each([undefined, "", "unknown", "LIVE"])("rejects absent/invalid provider %s", mode => {
    expect(() => readConfig({ MODEL_PROVIDER: mode })).toThrow("MODEL_PROVIDER");
  });
  it("requires a key in explicit live mode", () => {
    expect(() => readConfig({ MODEL_PROVIDER: "live" })).toThrow("MODEL_API_KEY");
    expect(readConfig({ MODEL_PROVIDER: "live", MODEL_API_KEY: "test" }).mode).toBe("live");
  });
  it("never switches an intentional fixture to live because a key exists", () => {
    expect(readConfig({ MODEL_PROVIDER: "fixture", MODEL_API_KEY: "test" }).mode).toBe("fixture");
  });
  const prod = { NODE_ENV: "production", MODEL_PROVIDER: "fixture", DATABASE_URL: "postgres://runtime@localhost/intake", APP_BASE_URL: "https://intake.example.com", SESSION_SECRET: "s".repeat(40), SECRET_ENCRYPTION_KEY: "k".repeat(40), MEDIA_STORAGE_PATH: "/data/media", META_USAGE_LEDGER: "/data/media/usage.json" };
  it("requires persistent SQL in production, including fixture mode", () => {
    expect(() => readConfig({ ...prod, DATABASE_URL: "" })).toThrow("DATABASE_URL");
    expect(readConfig(prod).mode).toBe("fixture");
  });
  it.each(["SESSION_SECRET", "SECRET_ENCRYPTION_KEY", "MEDIA_STORAGE_PATH", "META_USAGE_LEDGER", "APP_BASE_URL"])("validates production %s without revealing values", name => {
    expect(() => readConfig({ ...prod, [name]: "bad" })).toThrow(name);
  });
});
