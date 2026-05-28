import { resolveKeysFilter } from "../src/tools/getMetafields.js";

describe("get-metafields resolveKeysFilter", () => {
  it("returns undefined when no key/keys are provided (no filter)", () => {
    expect(resolveKeysFilter({})).toBeUndefined();
    expect(resolveKeysFilter({ namespace: "custom" })).toBeUndefined();
    expect(resolveKeysFilter({ keys: [] })).toBeUndefined();
  });

  it("passes a `keys` array straight through", () => {
    const out = resolveKeysFilter({
      keys: ["custom.vehicle_model", "custom.vehicle_year"],
    });
    expect(out).toEqual(["custom.vehicle_model", "custom.vehicle_year"]);
  });

  it("builds a one-element keys array from `key`+`namespace`", () => {
    const out = resolveKeysFilter({ key: "vehicle_model", namespace: "custom" });
    expect(out).toEqual(["custom.vehicle_model"]);
  });

  it("throws a clear error if `key` is passed without `namespace`", () => {
    expect(() => resolveKeysFilter({ key: "vehicle_model" })).toThrow(
      /key.*requires.*namespace/i,
    );
  });

  it("throws a clear either/or error if both `key` and `keys` are provided", () => {
    expect(() =>
      resolveKeysFilter({
        key: "vehicle_model",
        namespace: "custom",
        keys: ["custom.vehicle_year"],
      }),
    ).toThrow(/either.*key.*or.*keys/i);
  });
});
