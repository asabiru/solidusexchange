import { createHash } from "node:crypto";
import {
  type CallbackInbox,
  type InboxAction,
  type InboxSubject,
  KYT_ASSET_NETWORKS,
  type KytRiskLevel,
  type KytScenario,
  ProviderError,
  type ScheduledDelivery,
  createKytCallbackInbox,
  createKytCallbackVerifier,
  createKytSimulator,
  createNonceStore,
  createVerificationKeyring,
  formatAmount,
  generateSimulatorKey,
  kytBindingDigest,
  verificationKeyOf
} from "@solidchange/provider-simulators";
import { type ScreeningTarget, screeningTargetOf } from "../shared/address-screening.js";
import type { AddressScreeningStatus, AddressScreeningView } from "../shared/api.js";

export const maxAddressLength = 64;
export const maxScreeningsPerSubject = 10;
export const maxNewScreeningsPerWindow = 20;
export const screeningWindowSeconds = 3_600;
export const maxScreeningSubjects = 1_000;
export const maxTrackedAssessments = maxScreeningSubjects * maxScreeningsPerSubject;

const screeningIdPattern = /^scr_[0-9a-f]{32}$/;
const riskLevels: readonly KytRiskLevel[] = ["low", "medium", "high", "severe"];

export type ScreeningInputErrorCode = "invalid_target" | "invalid_address";

export class ScreeningInputError extends Error {
  constructor(readonly code: ScreeningInputErrorCode) {
    super(code);
    this.name = "ScreeningInputError";
  }
}

export class ScreeningRateLimitError extends Error {
  constructor() {
    super("screening_rate_limited");
    this.name = "ScreeningRateLimitError";
  }
}

export class ScreeningUnavailableError extends Error {
  constructor(readonly view: AddressScreeningView) {
    super("screening_unavailable");
    this.name = "ScreeningUnavailableError";
  }
}

export interface ScreeningInput {
  asset: string;
  network: string;
  address: string;
}

export type ScreeningCallbackResult =
  | { readonly verified: true; readonly action: InboxAction }
  | { readonly verified: false; readonly reason: string };

export interface AddressScreeningService {
  submit(subject: string, input: ScreeningInput): Promise<{ created: boolean; view: AddressScreeningView }>;
  view(subject: string, id: string): AddressScreeningView | undefined;
  /** Test seam: drain due signed deliveries without applying them. */
  drainDeliveries(): readonly ScheduledDelivery[];
  receiveCallback(delivery: { headers: unknown; body: unknown }, receivedAt?: number): ScreeningCallbackResult;
  /** Test seam: internal inbox state of one of the subject's screenings. */
  inspect(subject: string, id: string): InboxSubject | undefined;
  size(subject: string): number;
  /** Screenings tracked across all subjects (metrics gauge, no identifiers). */
  trackedCount(): number;
}

export interface AddressScreeningServiceOptions {
  seed: string;
  scenario: KytScenario;
  screeningTimeoutSeconds: number;
  clock: () => number;
}

interface Screening {
  id: string;
  target: ScreeningTarget;
  assessmentId?: string;
  submittedAt: number;
  deadline: number;
}

interface SubjectRecord {
  screenings: Map<string, Screening>;
  submissions: number[];
}

interface AssessmentResult {
  bindingDigest: string;
  candidates: Map<number, KytRiskLevel>;
  risk?: KytRiskLevel;
}

function digest(purpose: string, value: string): string {
  return createHash("sha256").update(`solidchange-miniapp-kyt|${purpose}|${value}`).digest("hex");
}

const base58Alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const tronAddressPattern = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const tonUrlSafePattern = /^[A-Za-z0-9_-]{48}$/;
const tonStandardPattern = /^[A-Za-z0-9+/]{48}$/;
const tonTestnetTags = new Set([0x91, 0xd1]);

function crc16(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

/** Testnet user-friendly TON address (bounceable or not); returns the raw `wc:hash` form. */
function canonicalTonAddress(address: string): string | undefined {
  const urlSafe = tonUrlSafePattern.test(address);
  if (!urlSafe && !tonStandardPattern.test(address)) return undefined;
  const bytes = Buffer.from(address, urlSafe ? "base64url" : "base64");
  if (bytes.length !== 36 || bytes.toString(urlSafe ? "base64url" : "base64") !== address) return undefined;
  if (!tonTestnetTags.has(bytes[0] ?? 0)) return undefined;
  const workchain = bytes[1];
  if (workchain !== 0x00 && workchain !== 0xff) return undefined;
  if (crc16(bytes.subarray(0, 34)) !== bytes.readUInt16BE(34)) return undefined;
  return `${workchain === 0xff ? -1 : 0}:${bytes.subarray(2, 34).toString("hex")}`;
}

/** Base58Check TRON address (0x41 prefix); testnet and mainnet share this syntax. */
function canonicalTronAddress(address: string): string | undefined {
  if (!tronAddressPattern.test(address)) return undefined;
  let value = 0n;
  for (const char of address) value = value * 58n + BigInt(base58Alphabet.indexOf(char));
  if (value >= 1n << 200n) return undefined;
  const bytes = Buffer.from(value.toString(16).padStart(50, "0"), "hex");
  if (bytes[0] !== 0x41) return undefined;
  const payload = bytes.subarray(0, 21);
  const check = createHash("sha256").update(createHash("sha256").update(payload).digest()).digest();
  if (!check.subarray(0, 4).equals(bytes.subarray(21))) return undefined;
  return address;
}

/** Syntactic testnet address check only; no network lookups. */
export function canonicalScreeningAddress(network: string, address: string): string | undefined {
  if (typeof address !== "string" || address.length === 0 || address.length > maxAddressLength) return undefined;
  if (network === "TON_TESTNET") return canonicalTonAddress(address);
  if (network === "TRON_TESTNET") return canonicalTronAddress(address);
  return undefined;
}

function supportedTarget(asset: string, network: string): ScreeningTarget | undefined {
  const target = screeningTargetOf(asset, network);
  if (!target) return undefined;
  return KYT_ASSET_NETWORKS.some((pair) => pair.asset === target.asset && pair.network === target.network)
    ? target
    : undefined;
}

/**
 * Test-mode address pre-screening backed by the KYT provider simulator. A risk
 * level is shown only after a verified, in-order signed callback; the result
 * is advisory evidence and never authorizes, blocks or executes a transfer.
 */
export function createAddressScreeningService(options: AddressScreeningServiceOptions): AddressScreeningService {
  const key = generateSimulatorKey({ keyId: "miniapp-bff-kyt", algorithm: "ed25519" });
  const nowSeconds = () => Math.floor(options.clock() / 1_000);
  const simulator = createKytSimulator({
    seed: options.seed,
    key,
    defaultScenario: options.scenario,
    screeningTimeoutSeconds: options.screeningTimeoutSeconds,
    clock: Object.freeze({
      now: nowSeconds,
      advance(): number {
        throw new Error("the BFF KYT clock follows the server clock");
      }
    })
  });
  const verify = createKytCallbackVerifier({
    keyring: createVerificationKeyring([verificationKeyOf(key)]),
    nonceStore: createNonceStore({ maxEntries: maxTrackedAssessments * 3 })
  });
  const inbox: CallbackInbox = createKytCallbackInbox();
  const subjects = new Map<string, SubjectRecord>();
  const results = new Map<string, AssessmentResult>();

  function releaseAssessment(assessmentId: string | undefined): void {
    if (assessmentId === undefined) return;
    results.delete(assessmentId);
    inbox.discard(assessmentId);
  }

  function track(assessmentId: string, bindingDigest: string): void {
    if (results.has(assessmentId)) return;
    results.set(assessmentId, { bindingDigest, candidates: new Map() });
    while (results.size > maxTrackedAssessments) {
      const oldest = results.keys().next().value;
      if (oldest === undefined) break;
      releaseAssessment(oldest);
    }
  }

  function receiveCallback(delivery: { headers: unknown; body: unknown }, receivedAt = nowSeconds()): ScreeningCallbackResult {
    const verified = verify({ headers: delivery.headers, body: delivery.body, now: receivedAt });
    if (!verified.ok) return { verified: false, reason: verified.reason };
    const { payload } = verified;
    const assessmentId = payload.assessment_id;
    const result = typeof assessmentId === "string" ? results.get(assessmentId) : undefined;
    if (typeof assessmentId !== "string" || !result || payload.binding_digest !== result.bindingDigest) {
      return { verified: false, reason: "unknown_assessment" };
    }
    const accepted = inbox.accept(payload, { receivedAt });
    if (
      (accepted.action === "applied" || accepted.action === "buffered")
      && payload.status === "completed"
      && typeof payload.sequence === "number"
      && riskLevels.includes(payload.risk_level as KytRiskLevel)
    ) {
      result.candidates.set(payload.sequence, payload.risk_level as KytRiskLevel);
    }
    if (accepted.appliedStatuses.includes("completed")) {
      const sequence = inbox.get(assessmentId)?.sequence;
      result.risk = sequence === undefined ? undefined : result.candidates.get(sequence);
      result.candidates.clear();
    }
    return { verified: true, action: accepted.action };
  }

  function sync(): void {
    // Deliveries are consumed at drain time, not at their scheduled
    // deliverAt: the signature staleness window and the inbox deadline are
    // measured against the real receive time.
    for (const delivery of simulator.drainCallbacks()) receiveCallback(delivery);
    inbox.expire(nowSeconds());
  }

  function statusOf(screening: Screening): AddressScreeningStatus {
    if (screening.assessmentId === undefined) return "unavailable";
    const state = inbox.get(screening.assessmentId);
    if (!state) return "unavailable";
    if (state.timedOut) return "timed_out";
    if (state.status !== "completed") return "pending";
    return results.get(screening.assessmentId)?.risk ?? "unavailable";
  }

  function viewOf(screening: Screening): AddressScreeningView {
    return Object.freeze({
      id: screening.id,
      mode: "test" as const,
      asset: screening.target.asset,
      network: screening.target.network,
      status: statusOf(screening),
      advisory: true as const,
      executable: false as const,
      submittedAt: screening.submittedAt,
      deadline: screening.deadline
    });
  }

  function subjectRecord(subject: string): SubjectRecord {
    let record = subjects.get(subject);
    if (record) {
      subjects.delete(subject);
    } else {
      record = { screenings: new Map(), submissions: [] };
    }
    subjects.set(subject, record);
    while (subjects.size > maxScreeningSubjects) {
      const oldest = subjects.keys().next().value;
      if (oldest === undefined) break;
      const dropped = subjects.get(oldest);
      subjects.delete(oldest);
      if (dropped !== undefined) {
        for (const screening of dropped.screenings.values()) {
          releaseAssessment(screening.assessmentId);
        }
      }
    }
    return record;
  }

  function store(record: SubjectRecord, screening: Screening): void {
    record.screenings.delete(screening.id);
    record.screenings.set(screening.id, screening);
    while (record.screenings.size > maxScreeningsPerSubject) {
      const oldest = record.screenings.keys().next().value;
      if (oldest === undefined) break;
      const dropped = record.screenings.get(oldest);
      record.screenings.delete(oldest);
      releaseAssessment(dropped?.assessmentId);
    }
  }

  async function submit(subject: string, input: ScreeningInput): Promise<{ created: boolean; view: AddressScreeningView }> {
    sync();
    const target = supportedTarget(input.asset, input.network);
    if (!target) throw new ScreeningInputError("invalid_target");
    const canonical = canonicalScreeningAddress(target.network, input.address);
    if (canonical === undefined) throw new ScreeningInputError("invalid_address");

    const binding = `${subject}|${target.asset}|${target.network}|${canonical}`;
    const id = `scr_${digest("screening", binding).slice(0, 32)}`;
    const record = subjectRecord(subject);
    const existing = record.screenings.get(id);
    if (existing?.assessmentId !== undefined) return { created: false, view: viewOf(existing) };

    const now = nowSeconds();
    record.submissions = record.submissions.filter((at) => at > now - screeningWindowSeconds);
    if (record.submissions.length >= maxNewScreeningsPerWindow) throw new ScreeningRateLimitError();
    record.submissions.push(now);

    const nominalAmount = formatAmount(target.asset, 1n);
    const providerAddress = `sim-${digest("address", `${target.network}|${canonical}`).slice(0, 40)}`;
    const screening: Screening = {
      id,
      target,
      submittedAt: options.clock(),
      deadline: (now + options.screeningTimeoutSeconds) * 1_000
    };
    try {
      const assessment = await simulator.screenTransfer({
        asset: target.asset,
        network: target.network,
        direction: "outbound",
        address: providerAddress,
        amount: nominalAmount,
        idempotency_key: `miniapp-kyt-${digest("idempotency", binding).slice(0, 40)}`
      });
      const expected = kytBindingDigest({
        asset: target.asset,
        network: target.network,
        direction: "outbound",
        address: providerAddress,
        tx_ref: null,
        amount: nominalAmount
      });
      const deadline = Math.floor(Date.parse(assessment.screening_deadline) / 1_000);
      if (assessment.status !== "pending" || assessment.binding_digest !== expected || !Number.isSafeInteger(deadline)) {
        store(record, screening);
        throw new ScreeningUnavailableError(viewOf(screening));
      }
      track(assessment.assessment_id, expected);
      if (!inbox.get(assessment.assessment_id)) inbox.openSubject(assessment.assessment_id, { deadline });
      screening.assessmentId = assessment.assessment_id;
      screening.deadline = deadline * 1_000;
    } catch (error) {
      if (error instanceof ScreeningUnavailableError) throw error;
      if (error instanceof ProviderError) {
        store(record, screening);
        throw new ScreeningUnavailableError(viewOf(screening));
      }
      throw error;
    }
    store(record, screening);
    sync();
    return { created: true, view: viewOf(screening) };
  }

  function find(subject: string, id: string): Screening | undefined {
    if (!screeningIdPattern.test(id)) return undefined;
    return subjects.get(subject)?.screenings.get(id);
  }

  return Object.freeze({
    submit,
    view(subject: string, id: string): AddressScreeningView | undefined {
      sync();
      const screening = find(subject, id);
      return screening ? viewOf(screening) : undefined;
    },
    drainDeliveries: () => simulator.drainCallbacks(),
    receiveCallback,
    inspect(subject: string, id: string): InboxSubject | undefined {
      sync();
      const assessmentId = find(subject, id)?.assessmentId;
      return assessmentId === undefined ? undefined : inbox.get(assessmentId);
    },
    size: (subject: string) => subjects.get(subject)?.screenings.size ?? 0,
    trackedCount: () => [...subjects.values()].reduce((total, record) => total + record.screenings.size, 0)
  });
}
