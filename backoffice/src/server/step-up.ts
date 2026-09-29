import { createHash, randomInt } from "node:crypto";
import type { StepUpConfig } from "./config.js";
import { createOpaqueValue } from "./oidc.js";
import { ExpiringStore } from "./session.js";

export interface StepUpBinding {
  sessionId: string;
  subject: string;
  approvalId: string;
  commandDigest: string;
  auditHeadHash: string;
}

export interface StepUpChallenge {
  challengeVersion: 1;
  challengeId: string;
  provider: "synthetic-dev";
  expiresAt: string;
  attemptsRemaining: number;
  devVerificationCode: string;
}

export interface StepUpVerification {
  grant: string;
  provider: "synthetic-dev";
  expiresAt: string;
}

export type StepUpFailureState =
  | "challenge_unavailable"
  | "binding_mismatch"
  | "invalid_code"
  | "attempts_exhausted"
  | "grant_rejected";

interface ChallengeRecord extends StepUpBinding {
  challengeVersion: 1;
  codeDigest: string;
  attemptsRemaining: number;
  expiresAt: number;
}

interface GrantRecord extends StepUpBinding {
  expiresAt: number;
}

export class StepUpRejectedError extends Error {
  constructor(
    readonly state: StepUpFailureState,
    readonly attemptsRemaining?: number
  ) {
    super("Step-up proof was rejected");
    this.name = "StepUpRejectedError";
  }
}

function codeDigest(challengeId: string, code: string): string {
  return createHash("sha256").update(`${challengeId}:${code}`).digest("hex");
}

function sameBinding(left: StepUpBinding, right: StepUpBinding): boolean {
  return left.sessionId === right.sessionId
    && left.subject === right.subject
    && left.approvalId === right.approvalId
    && left.commandDigest === right.commandDigest
    && left.auditHeadHash === right.auditHeadHash;
}

export class SyntheticStepUpService {
  readonly #config: StepUpConfig;
  readonly #clock: () => number;
  readonly #challenges: ExpiringStore<ChallengeRecord>;
  readonly #grants: ExpiringStore<GrantRecord>;
  readonly #challengeByBinding = new Map<string, string>();
  readonly #grantByBinding = new Map<string, string>();

  constructor(config: StepUpConfig, clock: () => number = Date.now) {
    this.#config = config;
    this.#clock = clock;
    this.#challenges = new ExpiringStore(clock);
    this.#grants = new ExpiringStore(clock);
  }

  begin(binding: StepUpBinding): StepUpChallenge {
    const bindingId = this.bindingId(binding);
    const previousChallenge = this.#challengeByBinding.get(bindingId);
    if (previousChallenge) this.#challenges.delete(previousChallenge);
    const challengeId = createOpaqueValue();
    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const now = this.#clock();
    const expiresAt = now + this.#config.challengeTtlSeconds * 1_000;
    this.#challenges.set(challengeId, {
      ...binding,
      challengeVersion: 1,
      codeDigest: codeDigest(challengeId, code),
      attemptsRemaining: this.#config.maxAttempts,
      expiresAt
    });
    this.#challengeByBinding.set(bindingId, challengeId);
    return {
      challengeVersion: 1,
      challengeId,
      provider: "synthetic-dev",
      expiresAt: new Date(expiresAt).toISOString(),
      attemptsRemaining: this.#config.maxAttempts,
      devVerificationCode: code
    };
  }

  verify(
    challengeId: string,
    code: string,
    binding: StepUpBinding
  ): StepUpVerification {
    const challenge = this.#challenges.get(challengeId);
    if (!challenge || challenge.challengeVersion !== 1) {
      throw new StepUpRejectedError("challenge_unavailable");
    }
    if (!sameBinding(challenge, binding)) throw new StepUpRejectedError("binding_mismatch");
    const bindingId = this.bindingId(binding);
    if (challenge.codeDigest !== codeDigest(challengeId, code)) {
      if (challenge.attemptsRemaining <= 1) {
        this.#challenges.delete(challengeId);
        this.deleteCurrent(this.#challengeByBinding, bindingId, challengeId);
        throw new StepUpRejectedError("attempts_exhausted", 0);
      } else {
        const attemptsRemaining = challenge.attemptsRemaining - 1;
        this.#challenges.set(challengeId, {
          ...challenge,
          attemptsRemaining
        });
        throw new StepUpRejectedError("invalid_code", attemptsRemaining);
      }
    }

    this.#challenges.delete(challengeId);
    this.deleteCurrent(this.#challengeByBinding, bindingId, challengeId);
    const grant = createOpaqueValue(32);
    const now = this.#clock();
    const expiresAt = now + this.#config.grantTtlSeconds * 1_000;
    const previousGrant = this.#grantByBinding.get(bindingId);
    if (previousGrant) this.#grants.delete(previousGrant);
    this.#grants.set(grant, { ...binding, expiresAt });
    this.#grantByBinding.set(bindingId, grant);
    return {
      grant,
      provider: "synthetic-dev",
      expiresAt: new Date(expiresAt).toISOString()
    };
  }

  consume(grant: string, binding: StepUpBinding): void {
    const record = this.#grants.take(grant);
    if (!record || !sameBinding(record, binding)) {
      throw new StepUpRejectedError("grant_rejected");
    }
    this.deleteCurrent(this.#grantByBinding, this.bindingId(binding), grant);
  }

  private bindingId(binding: StepUpBinding): string {
    return createHash("sha256").update(JSON.stringify(binding)).digest("hex");
  }

  private deleteCurrent(index: Map<string, string>, bindingId: string, value: string): void {
    if (index.get(bindingId) === value) index.delete(bindingId);
  }
}
