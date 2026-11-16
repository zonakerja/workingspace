import { describe, expect, it } from "vitest";
import { type RoutableModel, taskModelsProblem } from "./task-logic";

const base: RoutableModel = {
  id: "m",
  enabled: true,
  vision: false,
  embedding: false,
  audio: false,
  sourceKind: "router",
};
const models = new Map<string, RoutableModel>([
  ["chat", { ...base, id: "chat" }],
  ["vision", { ...base, id: "vision", vision: true }],
  ["embed", { ...base, id: "embed", embedding: true }],
  ["off", { ...base, id: "off", enabled: false }],
  ["gemini-audio", { ...base, id: "gemini-audio", audio: true, sourceKind: "gemini" }],
  ["router-audio", { ...base, id: "router-audio", audio: true }],
]);

describe("taskModelsProblem", () => {
  it("menerima utama + cadangan yang cocok", () => {
    expect(taskModelsProblem("chat", ["chat", "vision"], models)).toBeNull();
    expect(taskModelsProblem("embedding", ["embed"], models)).toBeNull();
    expect(taskModelsProblem("ocr", ["vision"], models)).toBeNull();
    expect(taskModelsProblem("transcribe", ["gemini-audio"], models)).toBeNull();
    expect(taskModelsProblem("chat", [], models)).toBeNull();
  });
  it("menolak yang tidak cocok", () => {
    expect(taskModelsProblem("chat", ["chat", "chat"], models)).toMatch(/dua kali/);
    expect(taskModelsProblem("chat", ["x"], models)).toMatch(/tidak ditemukan/);
    expect(taskModelsProblem("chat", ["off"], models)).toMatch(/dimatikan/);
    expect(taskModelsProblem("embedding", ["chat"], models)).toMatch(/embedding/);
    expect(taskModelsProblem("chat", ["embed"], models)).toMatch(/embedding/);
    expect(taskModelsProblem("ocr", ["chat"], models)).toMatch(/gambar/);
    expect(taskModelsProblem("transcribe", ["router-audio"], models)).toMatch(/Gemini/);
    expect(taskModelsProblem("chat", ["chat", "vision", "chat", "x", "y", "z"], models)).toMatch(/Maksimal/);
  });
});
