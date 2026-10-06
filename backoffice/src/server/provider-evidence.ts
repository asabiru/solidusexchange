import {
  type CallbackInbox,
  type CallbackVerifier,
  type InboxSubject,
  type KycScenario,
  type KycSubmission,
  type KytScenario,
  type KytScreening,
  type ScheduledDelivery,
  type SimulatorKey,
  ProviderError,
  createKycCallbackInbox,
  createKycCallbackVerifier,
  createKycSimulator,
  createKytCallbackInbox,
  createKytCallbackVerifier,
  createKytSimulator,
  createNonceStore,
  createSimulatedClock,
  createVerificationKeyring,
  generateSimulatorKey,
  verificationKeyOf
} from "@solidchange/provider-simulators";
import type { Tone } from "../data/demo.js";
import type {
  KycProviderEvidence,
  KytProviderEvidence,
  ProviderCallbackRecord,
  ProviderEvidenceFeed,
  ProviderOutage,
  ProviderVerificationSummary
} from "../data/provider-evidence.js";

// Synthetic, deterministic provider evidence for the dev BFF. Every callback is
// verified with the matching simulator verifier before it reaches the inbox
// projection, and nothing here can decide, approve or restrict a case: operator
// decisions stay on the maker-checker approval path.

const seed = "solidchange-backoffice-provider-evidence-v1";
const advanceSeconds = 7_200;
const held = new Set(["conflict", "late", "invalid_transition"]);

type Probe = "replay" | "tampered-body" | "foreign-key";

interface KycPlan {
  id: string;
  linkedCaseId: string | null;
  scenario: KycScenario;
  label: string;
  applicantRef: string;
  level: "basic" | "enhanced";
  probe?: Probe;
}

interface KytPlan {
  id: string;
  linkedCaseId: string | null;
  scenario: KytScenario;
  label: string;
  asset: "TON" | "USDT";
  network: "TON_TESTNET" | "TRON_TESTNET";
  direction: "inbound" | "outbound";
  addressRef: string;
  txRef: string;
  amount: string;
  probe?: Probe;
}

export const kycEvidencePlan: readonly KycPlan[] = [
  { id: "PEV-KYC-01", linkedCaseId: "KYC-220184", scenario: "approve", label: "Provider approved", applicantRef: "sim-bo-applicant-01", level: "basic", probe: "replay" },
  { id: "PEV-KYC-02", linkedCaseId: null, scenario: "reject", label: "Provider rejected", applicantRef: "sim-bo-applicant-02", level: "basic", probe: "tampered-body" },
  { id: "PEV-KYC-03", linkedCaseId: "KYC-220177", scenario: "needs_more_data", label: "Needs more data", applicantRef: "sim-bo-applicant-03", level: "enhanced" },
  { id: "PEV-KYC-04", linkedCaseId: "KYB-220165", scenario: "pending_timeout", label: "Review timed out", applicantRef: "sim-bo-applicant-04", level: "enhanced" },
  { id: "PEV-KYC-05", linkedCaseId: null, scenario: "provider_outage", label: "Provider outage", applicantRef: "sim-bo-applicant-05", level: "basic" },
  { id: "PEV-KYC-06", linkedCaseId: null, scenario: "duplicate_callback", label: "Duplicate callback", applicantRef: "sim-bo-applicant-06", level: "basic" },
  { id: "PEV-KYC-07", linkedCaseId: null, scenario: "out_of_order_callback", label: "Out-of-order callbacks", applicantRef: "sim-bo-applicant-07", level: "basic" },
  { id: "PEV-KYC-08", linkedCaseId: null, scenario: "late_callback", label: "Late callback", applicantRef: "sim-bo-applicant-08", level: "basic" }
];

export const kytEvidencePlan: readonly KytPlan[] = [
  { id: "PEV-KYT-01", linkedCaseId: "AML-78041", scenario: "high", label: "High risk exposure", asset: "USDT", network: "TRON_TESTNET", direction: "outbound", addressRef: "sim-bo-wallet-01", txRef: "sim-bo-tx-01", amount: "24500.000000" },
  { id: "PEV-KYT-02", linkedCaseId: "AML-78031", scenario: "sanctions_hit", label: "Sanctions hit", asset: "USDT", network: "TON_TESTNET", direction: "inbound", addressRef: "sim-bo-wallet-02", txRef: "sim-bo-tx-02", amount: "21148.000000", probe: "foreign-key" },
  { id: "PEV-KYT-03", linkedCaseId: "AML-78038", scenario: "low", label: "Low risk", asset: "TON", network: "TON_TESTNET", direction: "inbound", addressRef: "sim-bo-wallet-03", txRef: "sim-bo-tx-03", amount: "125.500000000" },
  { id: "PEV-KYT-04", linkedCaseId: null, scenario: "provider_outage", label: "Provider outage", asset: "TON", network: "TON_TESTNET", direction: "outbound", addressRef: "sim-bo-wallet-04", txRef: "sim-bo-tx-04", amount: "10.000000000" },
  { id: "PEV-KYT-05", linkedCaseId: null, scenario: "duplicate_callback", label: "Duplicate callback", asset: "USDT", network: "TRON_TESTNET", direction: "inbound", addressRef: "sim-bo-wallet-05", txRef: "sim-bo-tx-05", amount: "500.000000" },
  { id: "PEV-KYT-06", linkedCaseId: null, scenario: "out_of_order_callback", label: "Out-of-order callbacks", asset: "USDT", network: "TON_TESTNET", direction: "outbound", addressRef: "sim-bo-wallet-06", txRef: "sim-bo-tx-06", amount: "1200.000000" },
  { id: "PEV-KYT-07", linkedCaseId: null, scenario: "late_callback", label: "Late callback", asset: "TON", network: "TON_TESTNET", direction: "inbound", addressRef: "sim-bo-wallet-07", txRef: "sim-bo-tx-07", amount: "42.000000000" }
];

interface Delivery {
  delivery: ScheduledDelivery;
  origin: "simulator" | "synthetic-probe";
  probe: Probe | null;
}

interface Replay {
  records: ProviderCallbackRecord[];
  payloads: Readonly<Record<string, unknown>>[];
  latestClaim: Readonly<Record<string, unknown>> | undefined;
}

function iso(epochSeconds: number): string {
  return new Date(epochSeconds * 1_000).toISOString().replace(".000Z", "Z");
}

function epoch(value: string): number {
  return Date.parse(value) / 1_000;
}

function stringField(payload: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" ? value : null;
}

function numberField(payload: Readonly<Record<string, unknown>>, key: string): number | null {
  const value = payload[key];
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function stringList(payload: Readonly<Record<string, unknown>> | undefined, key: string): string[] {
  const value = payload?.[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function withProbe(
  deliveries: readonly ScheduledDelivery[],
  probe: Probe | undefined,
  forged: ScheduledDelivery | undefined
): Delivery[] {
  const result: Delivery[] = deliveries.map((delivery) => ({ delivery, origin: "simulator", probe: null }));
  const last = deliveries.at(-1);
  if (!probe || !last) return result;
  if (probe === "replay") {
    result.push({
      delivery: { deliverAt: last.deliverAt + 1, headers: { ...last.headers }, body: Buffer.from(last.body) },
      origin: "synthetic-probe",
      probe
    });
  } else if (probe === "tampered-body") {
    const body = Buffer.from(
      last.body.toString("utf8")
        .replace("\"status\":\"rejected\"", "\"status\":\"approved\"")
        .replace("[\"SIM_DOCUMENT_UNREADABLE\"]", "[]"),
      "utf8"
    );
    result.push({
      delivery: { deliverAt: last.deliverAt + 1, headers: { ...last.headers }, body },
      origin: "synthetic-probe",
      probe
    });
  } else if (forged) {
    result.push({
      delivery: { deliverAt: forged.deliverAt, headers: { ...forged.headers }, body: Buffer.from(forged.body) },
      origin: "synthetic-probe",
      probe
    });
  }
  return result;
}

function replayDeliveries(
  caseId: string,
  deliveries: readonly Delivery[],
  verify: CallbackVerifier,
  inbox: CallbackInbox
): Replay {
  const records: ProviderCallbackRecord[] = [];
  const payloads: Readonly<Record<string, unknown>>[] = [];
  const parked = new Map<ProviderCallbackRecord, Readonly<Record<string, unknown>>>();
  let latestClaim: Readonly<Record<string, unknown>> | undefined;
  deliveries.forEach(({ delivery, origin, probe }, index) => {
    const base = {
      deliveryId: `${caseId}-D${String(index + 1).padStart(2, "0")}`,
      deliveredAt: iso(delivery.deliverAt),
      origin,
      probe
    };
    const verified = verify({ headers: delivery.headers, body: delivery.body, now: delivery.deliverAt });
    if (!verified.ok) {
      records.push({
        ...base,
        verification: "rejected",
        verificationReason: verified.reason,
        eventId: null,
        sequence: null,
        status: null,
        inboxAction: null,
        accepted: false
      });
      return;
    }
    const payload = verified.payload;
    const result = inbox.accept(payload, { receivedAt: delivery.deliverAt });
    const sequence = numberField(payload, "sequence");
    if (sequence !== null && (latestClaim === undefined || sequence >= (numberField(latestClaim, "sequence") ?? 0))) {
      latestClaim = payload;
    }
    if (result.action === "applied") {
      const released = records
        .filter((record) => record.inboxAction === "buffered" && !record.accepted)
        .sort((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0))
        .slice(0, result.appliedStatuses.length - 1);
      payloads.push(payload);
      for (const record of released) {
        Object.assign(record, { accepted: true });
        const parkedPayload = parked.get(record);
        if (parkedPayload) payloads.push(parkedPayload);
      }
    }
    const record: ProviderCallbackRecord = {
      ...base,
      verification: "verified",
      verificationReason: null,
      eventId: stringField(payload, "event_id"),
      sequence,
      status: stringField(payload, "status"),
      inboxAction: result.action,
      accepted: result.action === "applied"
    };
    if (result.action === "buffered") parked.set(record, payload);
    records.push(record);
  });
  return { records, payloads, latestClaim };
}

function summarize(records: readonly ProviderCallbackRecord[]): ProviderVerificationSummary {
  const verified = records.filter((record) => record.verification === "verified").length;
  const rejected = records.length - verified;
  return {
    result: records.length === 0 ? "no-callbacks" : rejected > 0 ? "rejections-present" : "all-verified",
    delivered: records.length,
    verified,
    rejected,
    applied: records.filter((record) => record.accepted).length,
    heldForReview: records.filter((record) => record.inboxAction !== null && held.has(record.inboxAction)).length
  };
}

function outageOf(error: unknown): ProviderOutage {
  if (error instanceof ProviderError) return { code: error.code, retryable: error.retryable };
  throw error;
}

function subjectFields(subject: InboxSubject | undefined) {
  return {
    timedOut: subject?.timedOut ?? false,
    lateEvents: subject?.lateEvents ?? 0,
    reviewEvents: subject?.reviewEvents ?? 0,
    buffered: subject?.buffered ?? 0
  };
}

const operatorReview = {
  required: true,
  decision: null,
  decisionPath: "maker-checker-approval"
} as const;

const markers = {
  source: "provider-simulator",
  evidence_only: true,
  environment: "dev-simulator"
} as const;

function kycTone(status: string, outage: boolean, timedOut: boolean, held: number): Tone {
  if (outage || timedOut || held > 0) return "warning";
  if (status === "approved") return "success";
  if (status === "rejected") return "danger";
  if (status === "needs_more_data") return "warning";
  return "info";
}

function kytTone(level: string | null, sanctions: boolean | null, outage: boolean, timedOut: boolean, held: number): Tone {
  if (sanctions || level === "severe" || level === "high") return "danger";
  if (outage || timedOut || held > 0) return "warning";
  if (level === "low") return "success";
  return "info";
}

async function buildKycCase(plan: KycPlan, key: SimulatorKey): Promise<KycProviderEvidence> {
  const clock = createSimulatedClock();
  const simulator = createKycSimulator({
    seed: `${seed}:${plan.id}`,
    key,
    clock,
    scenarios: { [plan.applicantRef]: plan.scenario }
  });
  const verify = createKycCallbackVerifier({
    keyring: createVerificationKeyring([verificationKeyOf(key)]),
    nonceStore: createNonceStore()
  });
  const inbox = createKycCallbackInbox();
  const common = {
    ...markers,
    domain: "kyc" as const,
    id: plan.id,
    linkedCaseId: plan.linkedCaseId,
    scenario: plan.scenario,
    label: plan.label,
    applicantRef: plan.applicantRef,
    level: plan.level,
    operatorReview
  };
  let submission: KycSubmission;
  try {
    submission = await simulator.submitApplicant({
      applicant_ref: plan.applicantRef,
      level: plan.level,
      idempotency_key: `backoffice:${plan.id}`
    });
  } catch (error) {
    const outage = outageOf(error);
    return {
      ...common,
      providerReference: null,
      providerStatus: "unavailable",
      projectedStatus: "not-submitted",
      sequence: 0,
      deadline: null,
      ...subjectFields(undefined),
      outage,
      tone: "warning",
      reasonCodes: [],
      requestedItems: [],
      verification: summarize([]),
      receivedCallbacks: [],
      rejectedCallbacks: []
    };
  }
  const reference = submission.provider_reference;
  inbox.openSubject(reference, { deadline: epoch(submission.review_deadline) });
  clock.advance(advanceSeconds);
  const deliveries = withProbe(simulator.drainCallbacks(), plan.probe, undefined);
  const replay = replayDeliveries(plan.id, deliveries, verify, inbox);
  inbox.expire(clock.now());
  const subject = inbox.get(reference);
  const projected = replay.payloads.at(-1);
  const summary = summarize(replay.records);
  const fields = subjectFields(subject);
  const projectedStatus = subject?.status ?? "submitted";
  return {
    ...common,
    providerReference: reference,
    providerStatus: replay.latestClaim ? stringField(replay.latestClaim, "status") ?? "submitted" : "submitted",
    projectedStatus,
    sequence: subject?.sequence ?? 0,
    deadline: submission.review_deadline,
    ...fields,
    outage: null,
    tone: kycTone(projectedStatus, false, fields.timedOut, summary.heldForReview),
    reasonCodes: stringList(projected, "reason_codes"),
    requestedItems: stringList(projected, "requested_items"),
    verification: summary,
    receivedCallbacks: replay.records.filter((record) => record.verification === "verified"),
    rejectedCallbacks: replay.records.filter((record) => record.verification === "rejected")
  };
}

async function forgedKytDelivery(plan: KytPlan, foreignKey: SimulatorKey): Promise<ScheduledDelivery | undefined> {
  const clock = createSimulatedClock();
  const forger = createKytSimulator({ seed: `${seed}:${plan.id}:forged`, key: foreignKey, clock, defaultScenario: "low" });
  await forger.screenTransfer({
    asset: plan.asset,
    network: plan.network,
    direction: plan.direction,
    address: plan.addressRef,
    tx_ref: plan.txRef,
    amount: plan.amount,
    idempotency_key: `backoffice:${plan.id}:forged`
  });
  clock.advance(advanceSeconds);
  return forger.drainCallbacks().at(-1);
}

async function buildKytCase(plan: KytPlan, key: SimulatorKey, foreignKey: SimulatorKey): Promise<KytProviderEvidence> {
  const clock = createSimulatedClock();
  const simulator = createKytSimulator({
    seed: `${seed}:${plan.id}`,
    key,
    clock,
    scenarios: { [plan.addressRef]: plan.scenario }
  });
  const verify = createKytCallbackVerifier({
    keyring: createVerificationKeyring([verificationKeyOf(key)]),
    nonceStore: createNonceStore()
  });
  const inbox = createKytCallbackInbox();
  const common = {
    ...markers,
    domain: "kyt" as const,
    id: plan.id,
    linkedCaseId: plan.linkedCaseId,
    scenario: plan.scenario,
    label: plan.label,
    asset: plan.asset,
    network: plan.network,
    direction: plan.direction,
    addressRef: plan.addressRef,
    txRef: plan.txRef,
    amount: plan.amount,
    operatorReview
  };
  let screening: KytScreening;
  try {
    screening = await simulator.screenTransfer({
      asset: plan.asset,
      network: plan.network,
      direction: plan.direction,
      address: plan.addressRef,
      tx_ref: plan.txRef,
      amount: plan.amount,
      idempotency_key: `backoffice:${plan.id}`
    });
  } catch (error) {
    const outage = outageOf(error);
    return {
      ...common,
      providerReference: null,
      providerStatus: "unavailable",
      projectedStatus: "not-screened",
      sequence: 0,
      deadline: null,
      ...subjectFields(undefined),
      outage,
      tone: "warning",
      bindingDigest: null,
      riskLevel: null,
      riskScore: null,
      sanctionsHit: null,
      reasonCodes: [],
      verification: summarize([]),
      receivedCallbacks: [],
      rejectedCallbacks: []
    };
  }
  const reference = screening.assessment_id;
  inbox.openSubject(reference, { deadline: epoch(screening.screening_deadline) });
  clock.advance(advanceSeconds);
  const forged = plan.probe === "foreign-key" ? await forgedKytDelivery(plan, foreignKey) : undefined;
  const deliveries = withProbe(simulator.drainCallbacks(), plan.probe, forged);
  const replay = replayDeliveries(plan.id, deliveries, verify, inbox);
  inbox.expire(clock.now());
  const subject = inbox.get(reference);
  const projected = replay.payloads.at(-1);
  const summary = summarize(replay.records);
  const fields = subjectFields(subject);
  const riskLevel = projected ? stringField(projected, "risk_level") : null;
  const sanctionsValue = projected?.sanctions_hit;
  const sanctionsHit = typeof sanctionsValue === "boolean" ? sanctionsValue : null;
  return {
    ...common,
    providerReference: reference,
    providerStatus: replay.latestClaim ? stringField(replay.latestClaim, "status") ?? "requested" : "requested",
    projectedStatus: subject?.status ?? "requested",
    sequence: subject?.sequence ?? 0,
    deadline: screening.screening_deadline,
    ...fields,
    outage: null,
    tone: kytTone(riskLevel, sanctionsHit, false, fields.timedOut, summary.heldForReview),
    bindingDigest: screening.binding_digest,
    riskLevel,
    riskScore: projected ? numberField(projected, "risk_score") : null,
    sanctionsHit,
    reasonCodes: stringList(projected, "categories"),
    verification: summary,
    receivedCallbacks: replay.records.filter((record) => record.verification === "verified"),
    rejectedCallbacks: replay.records.filter((record) => record.verification === "rejected")
  };
}

function feed<T extends KycProviderEvidence | KytProviderEvidence>(cases: readonly T[]): ProviderEvidenceFeed<T> {
  return deepFreeze({
    ...markers,
    decisionAuthority: "none",
    decisionPath: "maker-checker-approval",
    cases
  });
}

export interface ProviderEvidenceSource {
  kyc(): Promise<ProviderEvidenceFeed<KycProviderEvidence>>;
  kyt(): Promise<ProviderEvidenceFeed<KytProviderEvidence>>;
}

export async function buildKycEvidence(): Promise<ProviderEvidenceFeed<KycProviderEvidence>> {
  const key = generateSimulatorKey({ keyId: "sim-bo-kyc" });
  const cases: KycProviderEvidence[] = [];
  for (const plan of kycEvidencePlan) cases.push(await buildKycCase(plan, key));
  return feed(cases);
}

export async function buildKytEvidence(): Promise<ProviderEvidenceFeed<KytProviderEvidence>> {
  const key = generateSimulatorKey({ keyId: "sim-bo-kyt" });
  const foreignKey = generateSimulatorKey({ keyId: "sim-bo-kyt" });
  const cases: KytProviderEvidence[] = [];
  for (const plan of kytEvidencePlan) cases.push(await buildKytCase(plan, key, foreignKey));
  return feed(cases);
}

export function createProviderEvidenceSource(): ProviderEvidenceSource {
  let kyc: Promise<ProviderEvidenceFeed<KycProviderEvidence>> | undefined;
  let kyt: Promise<ProviderEvidenceFeed<KytProviderEvidence>> | undefined;
  return Object.freeze({
    kyc: () => {
      kyc ??= buildKycEvidence();
      return kyc;
    },
    kyt: () => {
      kyt ??= buildKytEvidence();
      return kyt;
    }
  });
}
