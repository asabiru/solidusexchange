import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { StepUpConfig } from "./config.js";
import {
  StepUpRejectedError,
  SyntheticStepUpService,
  type StepUpBinding
} from "./step-up.js";

const config: StepUpConfig = {
  provider: "synthetic-dev",
  challengeTtlSeconds: 30,
  grantTtlSeconds: 15,
  maxAttempts: 3
};

const binding: StepUpBinding = {
  sessionId: "session-1",
  subject: "operator-1",
  approvalId: "APV-843910",
  commandDigest: "a".repeat(64),
  auditHeadHash: "b".repeat(64)
};

function rejectedState(action: () => unknown): string {
  try {
    action();
    assert.fail("Expected step-up rejection");
  } catch (error) {
    assert.ok(error instanceof StepUpRejectedError);
    return error.state;
  }
}

describe("synthetic step-up lifecycle", () => {
  it("binds a one-time challenge and grant to the exact control context", () => {
    const now = Date.parse("2026-09-29T12:00:00.000Z");
    const service = new SyntheticStepUpService(config, () => now);
    const challenge = service.begin(binding);
    assert.equal(challenge.challengeVersion, 1);
    assert.match(challenge.challengeId, /^[A-Za-z0-9_-]{32,}$/);
    assert.match(challenge.devVerificationCode, /^\d{6}$/);
    assert.equal(challenge.attemptsRemaining, 3);
    assert.equal(
      rejectedState(() => service.verify(
        challenge.challengeId,
        challenge.devVerificationCode,
        { ...binding, sessionId: "session-2" }
      )),
      "binding_mismatch"
    );

    const verification = service.verify(
      challenge.challengeId,
      challenge.devVerificationCode,
      binding
    );
    assert.equal(verification.provider, "synthetic-dev");
    assert.equal(
      rejectedState(() => service.verify(
        challenge.challengeId,
        challenge.devVerificationCode,
        binding
      )),
      "challenge_unavailable"
    );
    service.consume(verification.grant, binding);
    assert.equal(
      rejectedState(() => service.consume(verification.grant, binding)),
      "grant_rejected"
    );
  });

  it("rejects every changed session, subject, approval, command and audit binding", () => {
    const changes: readonly Partial<StepUpBinding>[] = [
      { sessionId: "session-2" },
      { subject: "operator-2" },
      { approvalId: "APV-843904" },
      { commandDigest: "c".repeat(64) },
      { auditHeadHash: "d".repeat(64) }
    ];
    for (const change of changes) {
      const service = new SyntheticStepUpService(config);
      const challenge = service.begin(binding);
      assert.equal(
        rejectedState(() => service.verify(
          challenge.challengeId,
          challenge.devVerificationCode,
          { ...binding, ...change }
        )),
        "binding_mismatch"
      );
      const verification = service.verify(
        challenge.challengeId,
        challenge.devVerificationCode,
        binding
      );
      assert.equal(
        rejectedState(() => service.consume(
          verification.grant,
          { ...binding, ...change }
        )),
        "grant_rejected"
      );
    }
  });

  it("locks a challenge after the configured attempt limit", () => {
    const service = new SyntheticStepUpService(config);
    const challenge = service.begin(binding);
    const wrongCode = challenge.devVerificationCode === "999999" ? "000000" : "999999";
    for (const expected of [2, 1]) {
      try {
        service.verify(challenge.challengeId, wrongCode, binding);
        assert.fail("Expected invalid code rejection");
      } catch (error) {
        assert.ok(error instanceof StepUpRejectedError);
        assert.equal(error.state, "invalid_code");
        assert.equal(error.attemptsRemaining, expected);
      }
    }
    try {
      service.verify(challenge.challengeId, wrongCode, binding);
      assert.fail("Expected attempt exhaustion");
    } catch (error) {
      assert.ok(error instanceof StepUpRejectedError);
      assert.equal(error.state, "attempts_exhausted");
      assert.equal(error.attemptsRemaining, 0);
    }
    assert.equal(
      rejectedState(() => service.verify(
        challenge.challengeId,
        challenge.devVerificationCode,
        binding
      )),
      "challenge_unavailable"
    );
  });

  it("replaces older challenges for the same bound action", () => {
    const service = new SyntheticStepUpService(config);
    const first = service.begin(binding);
    const second = service.begin(binding);
    assert.equal(
      rejectedState(() => service.verify(
        first.challengeId,
        first.devVerificationCode,
        binding
      )),
      "challenge_unavailable"
    );
    const verification = service.verify(
      second.challengeId,
      second.devVerificationCode,
      binding
    );
    service.consume(verification.grant, binding);
  });

  it("expires challenges and grants fail closed", () => {
    let now = Date.parse("2026-09-29T12:00:00.000Z");
    const service = new SyntheticStepUpService(config, () => now);
    const expiredChallenge = service.begin(binding);
    now += 30_001;
    assert.equal(
      rejectedState(() => service.verify(
        expiredChallenge.challengeId,
        expiredChallenge.devVerificationCode,
        binding
      )),
      "challenge_unavailable"
    );

    const challenge = service.begin(binding);
    const verification = service.verify(
      challenge.challengeId,
      challenge.devVerificationCode,
      binding
    );
    now += 15_001;
    assert.equal(
      rejectedState(() => service.consume(verification.grant, binding)),
      "grant_rejected"
    );
  });
});
