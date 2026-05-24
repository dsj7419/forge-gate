import { describe, expect, test } from "vitest";

import {
  BlastRadiusEnum,
  ChangeClassEnum,
  GateEnum,
  KindEnum,
  RiskEnum,
  StatusEnum,
  VerifierEnum,
} from "./enums.js";

describe("enums", () => {
  test("KindEnum accepts the four ticket kinds and rejects others", () => {
    for (const value of ["plan", "red", "green", "closeout"]) {
      expect(KindEnum.safeParse(value).success).toBe(true);
    }
    expect(KindEnum.safeParse("blue").success).toBe(false);
  });

  test("StatusEnum accepts lifecycle states and rejects unknown ones", () => {
    expect(StatusEnum.safeParse("ready_for_pr").success).toBe(true);
    expect(StatusEnum.safeParse("escalated").success).toBe(true);
    expect(StatusEnum.safeParse("done").success).toBe(false);
  });

  test("GateEnum accepts the five gate levels", () => {
    for (const value of ["none", "pr", "merge", "phase", "manual"]) {
      expect(GateEnum.safeParse(value).success).toBe(true);
    }
    expect(GateEnum.safeParse("auto").success).toBe(false);
  });

  test("VerifierEnum accepts none|single|two-pass", () => {
    expect(VerifierEnum.safeParse("two-pass").success).toBe(true);
    expect(VerifierEnum.safeParse("triple").success).toBe(false);
  });

  test("Risk, ChangeClass and BlastRadius enums reject unknown values", () => {
    expect(RiskEnum.safeParse("critical").success).toBe(true);
    expect(RiskEnum.safeParse("apocalyptic").success).toBe(false);
    expect(ChangeClassEnum.safeParse("security").success).toBe(true);
    expect(ChangeClassEnum.safeParse("magic").success).toBe(false);
    expect(BlastRadiusEnum.safeParse("cross_module").success).toBe(true);
    expect(BlastRadiusEnum.safeParse("galaxy").success).toBe(false);
  });
});
