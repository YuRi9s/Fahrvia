import { it, expect } from "vitest";
import { parseIsolated } from "../src/features/score/isolated-parser";
it("parses a score in an isolated process and rejects active content", async () => {
  const drivers = [
    { id: "one", email: "driver@example.test", transporterId: "DE1" },
  ];
  const result = await parseIsolated(
    new TextEncoder().encode("transporterId,totalScore\nDE1,91\n"),
    "score.csv",
    "2026-W37",
    {},
    drivers,
  );
  expect(result.rows[0].totalScore).toBe(91);
  await expect(
    parseIsolated(
      new TextEncoder().encode("transporterId,totalScore\nDE1,=1+1\n"),
      "score.csv",
      "2026-W37",
      {},
      drivers,
    ),
  ).rejects.toThrow("Formeln");
});
