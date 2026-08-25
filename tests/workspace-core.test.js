import assert from "node:assert/strict";
import test from "node:test";

import { settleOptionalQuery } from "../workspace-core.js";

test("settleOptionalQuery maps successful Supabase data", async () => {
  const result = await settleOptionalQuery(
    Promise.resolve({ data: [{ value: 2 }], error: null }),
    (rows) => rows.map(({ value }) => value * 3),
  );

  assert.deepEqual(result, { data: [6], error: null });
});

test("settleOptionalQuery contains Supabase result errors", async () => {
  const failure = { message: "relation does not exist", code: "42P01" };
  const result = await settleOptionalQuery(Promise.resolve({ data: null, error: failure }));

  assert.deepEqual(result.data, []);
  assert.equal(result.error, failure);
});

test("settleOptionalQuery contains rejected transport failures", async () => {
  const failure = new Error("network unavailable");
  const result = await settleOptionalQuery(Promise.reject(failure));

  assert.deepEqual(result.data, []);
  assert.equal(result.error, failure);
});
