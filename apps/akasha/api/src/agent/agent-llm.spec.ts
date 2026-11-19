import { describe, expect, it } from "vitest";
import { API_SCOPES } from "../integrations/api-token-logic";
import { AGENT_CONTEXT_LENGTH, AGENT_MODEL_ID, DEFAULT_AGENT_SCOPES, modelsResponse } from "./agent-llm";

describe("proxy model agen", () => {
  it("daftar model: satu model akasha-agent, model Akai sebagai upstream", () => {
    const res = modelsResponse("claude-sonnet-5-5");
    expect(res.data).toHaveLength(1);
    expect(res.data[0]).toMatchObject({
      id: AGENT_MODEL_ID,
      context_length: AGENT_CONTEXT_LENGTH,
      upstream_model: "claude-sonnet-5-5",
    });
    expect(modelsResponse(null).data[0]).not.toHaveProperty("upstream_model");
  });

  it("izin bawaan agen = semua cakupan, termasuk ai:model", () => {
    expect(DEFAULT_AGENT_SCOPES).toEqual([...API_SCOPES]);
    expect(DEFAULT_AGENT_SCOPES).toContain("ai:model");
  });
});
