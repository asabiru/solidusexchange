import { createHash } from "node:crypto";
import {
  type InboxAction,
  type InboxSubject,
  type KycScenario,
  type ScheduledDelivery,
  ProviderError,
  createKycCallbackInbox,
  createKycCallbackVerifier,
  createKycSimulator,
  createNonceStore,
  createVerificationKeyring,
  generateSimulatorKey,
  verificationKeyOf
} from "@solidchange/provider-simulators";
import type { KycStatus, KycVerificationState, KycVerificationView } from "../shared/api.js";

export interface KycServiceOptions {
  seed: string;
  scenario: KycScenario;
  reviewTimeoutSeconds: number;
  clock: () => number;
}

export interface KycDelivery {
  headers: unknown;
  body: unknown;
}

export type KycCallbackResult =
  | { readonly verified: true; readonly action: InboxAction }
  | { readonly verified: false; readonly reason: string };

export type KycTransitionListener = (subject: string, state: KycVerificationState) => void;

export interface KycService {
  subscribe(listener: KycTransitionListener): () => void;
  submit(subject: string): Promise<{ created: boolean }>;
  view(subject: string, sessionKyc: KycStatus): KycVerificationView;
  isVerified(subject: string): boolean;
  reset(subject: string): void;
  /** Diagnostic: sizes of the provider-reference reverse indexes; both equal the number of live applications. */
  indexSizes(): { applicants: number; subjects: number };
  drainDeliveries(): readonly ScheduledDelivery[];
  receiveCallback(delivery: KycDelivery, receivedAt?: number): KycCallbackResult;
  inspect(subject: string): InboxSubject | undefined;
}

export class KycUnavailableError extends Error {
  constructor() {
    super("KYC provider simulator is unavailable");
    this.name = "KycUnavailableError";
  }
}

interface Application {
  providerReference: string;
  applicantRef: string;
  submittedAt: number;
  deadline: number;
}

interface ApplicantRecord {
  attempt: number;
  unavailable: boolean;
  application?: Application;
  lastState?: KycVerificationState;
}

const providerStates: readonly KycVerificationState[] = ["submitted", "in_review", "approved", "rejected", "needs_more_data"];

function digest(label: string, value: string): string {
  return createHash("sha256").update(`solidchange-miniapp-kyc|${label}|${value}`).digest("hex");
}

/** Synthetic, non-PII applicant reference derived from the BFF session subject. */
export function applicantRefOf(subject: string): string {
  return `sim-${digest("applicant", subject).slice(0, 32)}`;
}

/**
 * Test-mode KYC onboarding backed by the provider-neutral KYC simulator.
 * Decisions arrive only as signed callbacks; each one is verified and passed
 * through the ordered callback inbox before the projection changes. Provider
 * output is evidence for the dev session gate only, never ledger, custody or
 * regulated-decision authority.
 */
export function createKycService(options: KycServiceOptions): KycService {
  const key = generateSimulatorKey({ keyId: "miniapp-bff-kyc", algorithm: "ed25519" });
  const nowSeconds = () => Math.floor(options.clock() / 1_000);
  const simulator = createKycSimulator({
    seed: options.seed,
    key,
    defaultScenario: options.scenario,
    reviewTimeoutSeconds: options.reviewTimeoutSeconds,
    clock: Object.freeze({
      now: nowSeconds,
      advance(): number {
        throw new Error("the BFF KYC clock follows the server clock");
      }
    })
  });
  const verify = createKycCallbackVerifier({
    keyring: createVerificationKeyring([verificationKeyOf(key)]),
    nonceStore: createNonceStore()
  });
  const inbox = createKycCallbackInbox();
  const records = new Map<string, ApplicantRecord>();
  const applicantsByReference = new Map<string, string>();
  const subjectsByReference = new Map<string, string>();
  const listeners = new Set<KycTransitionListener>();

  function transition(subject: string, state: KycVerificationState): void {
    const record = records.get(subject);
    if (!record || record.lastState === state) return;
    record.lastState = state;
    for (const listener of listeners) listener(subject, state);
  }

  function transitionFor(reference: string, state: KycVerificationState): void {
    const subject = subjectsByReference.get(reference);
    if (subject && records.get(subject)?.application?.providerReference === reference) transition(subject, state);
  }

  function recordOf(subject: string): ApplicantRecord {
    let record = records.get(subject);
    if (!record) {
      record = { attempt: 0, unavailable: false };
      records.set(subject, record);
    }
    return record;
  }

  function receiveCallback(delivery: KycDelivery, receivedAt = nowSeconds()): KycCallbackResult {
    const verified = verify({ headers: delivery.headers, body: delivery.body, now: receivedAt });
    if (!verified.ok) return { verified: false, reason: verified.reason };
    const { payload } = verified;
    const reference = payload.provider_reference;
    if (typeof reference !== "string" || applicantsByReference.get(reference) !== payload.applicant_ref) {
      return { verified: false, reason: "unknown_application" };
    }
    const accepted = inbox.accept(payload, { receivedAt });
    for (const status of accepted.appliedStatuses) {
      const state = providerStates.find((candidate) => candidate === status);
      if (state) transitionFor(reference, state);
    }
    return { verified: true, action: accepted.action };
  }

  function sync(): void {
    for (const delivery of simulator.drainCallbacks()) {
      receiveCallback(delivery, delivery.deliverAt);
    }
    for (const reference of inbox.expire(nowSeconds())) transitionFor(reference, "timed_out");
  }

  function stateOf(application: Application): KycVerificationState {
    const subject = inbox.get(application.providerReference);
    if (!subject) return "unavailable";
    if (subject.timedOut) return "timed_out";
    return providerStates.find((state) => state === subject.status) ?? "in_review";
  }

  return Object.freeze({
    subscribe(listener: KycTransitionListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    async submit(subject: string): Promise<{ created: boolean }> {
      sync();
      const record = recordOf(subject);
      if (record.application) return { created: false };
      const applicantRef = applicantRefOf(subject);
      let submission: Awaited<ReturnType<typeof simulator.submitApplicant>>;
      try {
        submission = await simulator.submitApplicant({
          applicant_ref: applicantRef,
          level: "basic",
          idempotency_key: `miniapp-kyc:${digest("attempt", `${subject}|${record.attempt}`).slice(0, 40)}`
        });
      } catch (error) {
        if (error instanceof ProviderError && error.code === "provider_unavailable") {
          record.unavailable = true;
          transition(subject, "unavailable");
          throw new KycUnavailableError();
        }
        throw error;
      }
      if (records.get(subject)?.application?.providerReference === submission.provider_reference) return { created: false };
      if (submission.applicant_ref !== applicantRef || submission.status !== "submitted") {
        throw new KycUnavailableError();
      }
      const deadline = Date.parse(submission.review_deadline) / 1_000;
      inbox.openSubject(submission.provider_reference, { deadline });
      applicantsByReference.set(submission.provider_reference, applicantRef);
      subjectsByReference.set(submission.provider_reference, subject);
      record.application = {
        providerReference: submission.provider_reference,
        applicantRef,
        submittedAt: Date.parse(submission.submitted_at),
        deadline
      };
      record.unavailable = false;
      transition(subject, "submitted");
      return { created: true };
    },

    view(subject: string, sessionKyc: KycStatus): KycVerificationView {
      sync();
      const record = records.get(subject);
      const application = record?.application;
      if (!application) {
        const state: KycVerificationState = sessionKyc === "verified"
          ? "approved"
          : record?.unavailable ? "unavailable" : "not_started";
        return { mode: "test", provider: "simulator", state, sessionKyc, canSubmit: state !== "approved" };
      }
      return {
        mode: "test",
        provider: "simulator",
        state: stateOf(application),
        sessionKyc,
        canSubmit: false,
        submittedAt: application.submittedAt,
        reviewDeadline: application.deadline * 1_000
      };
    },

    isVerified(subject: string): boolean {
      sync();
      const application = records.get(subject)?.application;
      return application !== undefined && stateOf(application) === "approved";
    },

    reset(subject: string): void {
      const record = recordOf(subject);
      record.attempt += 1;
      record.unavailable = false;
      if (record.application) {
        // The attempt is discarded, so its provider-reference index entries
        // must go too: they are permanent otherwise and grow on every reset.
        applicantsByReference.delete(record.application.providerReference);
        subjectsByReference.delete(record.application.providerReference);
        record.application = undefined;
      }
      record.lastState = undefined;
    },

    indexSizes(): { applicants: number; subjects: number } {
      return { applicants: applicantsByReference.size, subjects: subjectsByReference.size };
    },

    drainDeliveries(): readonly ScheduledDelivery[] {
      return simulator.drainCallbacks();
    },

    receiveCallback,

    inspect(subject: string): InboxSubject | undefined {
      const application = records.get(subject)?.application;
      return application ? inbox.get(application.providerReference) : undefined;
    }
  });
}
