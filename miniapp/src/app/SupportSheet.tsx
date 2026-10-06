import { type FormEvent, type RefObject, useEffect, useId, useRef, useState } from "react";
import type { ActivityItem, ActivityKind, SupportRequestView } from "../shared/api";
import { screeningTargetOf } from "../shared/address-screening";
import {
  type SupportCategory,
  type SupportStatus,
  isValidSupportMessage,
  isValidSupportTopic,
  maxSupportMessageLength,
  maxSupportTopicLength,
  supportCategories
} from "../shared/support";
import { ApiError, api } from "./api";
import { type MessageKey, messageKeyFor } from "./i18n";
import { useI18n } from "./i18n-context";
import { Icon } from "./Icon";
import { Sheet } from "./ui";

export const supportCategoryKeys: Readonly<Record<SupportCategory, MessageKey>> = {
  question: "support.categoryQuestion",
  operation_problem: "support.categoryOperation",
  complaint: "support.categoryComplaint",
  data_request: "support.categoryData"
};

const statusBadges: Readonly<Record<SupportStatus, { label: MessageKey; tone: string }>> = {
  received: { label: "support.statusReceived", tone: "muted" },
  in_review: { label: "support.statusInReview", tone: "warning" },
  answered: { label: "support.statusAnswered", tone: "success" },
  closed: { label: "support.statusClosed", tone: "muted" }
};

const activityKindKeys: Readonly<Record<ActivityKind, MessageKey>> = {
  session_login: "activity.login",
  kyc_submitted: "activity.kycSubmitted",
  kyc_in_review: "activity.kycInReview",
  kyc_approved: "activity.kycApproved",
  kyc_rejected: "activity.kycRejected",
  kyc_needs_more_data: "activity.kycNeedsMoreData",
  kyc_timed_out: "activity.kycTimedOut",
  kyc_unavailable: "activity.kycUnavailable",
  quote_previewed: "activity.filterQuote",
  address_screened: "activity.filterScreening",
  support_requested: "common.support"
};

type Field = "topic" | "message" | "activityId";

const fieldErrors: Readonly<Record<string, MessageKey>> = {
  invalid_topic: "support.errorTopic",
  invalid_message: "support.errorMessage",
  invalid_reference: "support.errorReference"
};

const fieldOfError: Readonly<Record<string, Field>> = {
  invalid_topic: "topic",
  invalid_message: "message",
  invalid_reference: "activityId"
};

const formErrors: Readonly<Record<string, MessageKey>> = {
  invalid_category: "support.errorCategory",
  support_rate_limited: "support.errorRateLimited",
  support_limit_reached: "support.errorLimit",
  support_capacity: "support.errorCapacity"
};

type Mode = { kind: "list" } | { kind: "form" } | { kind: "detail"; request: SupportRequestView };

function TestBanner() {
  const { t } = useI18n();
  return (
    <p className="notice-banner">
      <Icon name="info" size="sm" />
      {t("support.banner")}
    </p>
  );
}

export function SupportSheet({ close }: { close: () => void }) {
  const [requests, setRequests] = useState<readonly SupportRequestView[] | undefined>();
  const [failed, setFailed] = useState(false);
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [announcement, setAnnouncement] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const [switches, setSwitches] = useState(0);
  const { t } = useI18n();

  useEffect(() => {
    let active = true;
    api.supportRequests()
      .then((view) => { if (active) setRequests(view.requests); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (switches > 0) heading.current?.focus();
  }, [switches]);

  const show = (next: Mode) => {
    setSwitches((count) => count + 1);
    setAnnouncement("");
    setMode(next);
  };

  return (
    <Sheet title={t("common.support")} onClose={close}>
      <TestBanner />
      <p className="visually-hidden" aria-live="polite" aria-atomic="true">{announcement}</p>
      {mode.kind === "form" ? (
        <SupportForm
          heading={heading}
          onCancel={() => show({ kind: "list" })}
          onCreated={(created) => {
            setRequests((current) => [created, ...(current ?? [])]);
            show({ kind: "detail", request: created });
            setAnnouncement(t("support.created"));
          }}
        />
      ) : mode.kind === "detail" ? (
        <SupportDetail heading={heading} request={mode.request} onBack={() => show({ kind: "list" })} />
      ) : (
        <SupportList
          heading={heading}
          requests={requests}
          failed={failed}
          onNew={() => show({ kind: "form" })}
          onOpen={(request) => show({ kind: "detail", request })}
        />
      )}
    </Sheet>
  );
}

interface HeadingProps {
  heading: RefObject<HTMLHeadingElement | null>;
}

function SupportList({ heading, requests, failed, onNew, onOpen }: HeadingProps & {
  requests: readonly SupportRequestView[] | undefined;
  failed: boolean;
  onNew: () => void;
  onOpen: (request: SupportRequestView) => void;
}) {
  const { t, format } = useI18n();
  return (
    <>
      <p className="sheet__note">{t("support.note")}</p>
      <button type="button" className="cta cta--secondary" onClick={onNew}>
        <Icon name="plus" size="sm" />{t("support.new")}
      </button>
      <h3 className="section-label" ref={heading} tabIndex={-1}>{t("support.listTitle")}</h3>
      <div aria-live="polite">
        {failed ? <p className="form-error">{t("support.loadFailed")}</p> : null}
        {requests === undefined && !failed ? <p className="sheet__note">{t("common.loading")}</p> : null}
        {requests?.length === 0 ? <p className="sheet__note">{t("support.empty")}</p> : null}
      </div>
      {requests && requests.length > 0 ? (
        <ul className="list" aria-label={t("support.listLabel")}>
          {requests.map((request) => {
            const badge = statusBadges[request.status];
            return (
              <li key={request.id}>
                <button type="button" className="row" onClick={() => onOpen(request)}>
                  <span className="coin coin--menu" aria-hidden="true"><Icon name="help" size="sm" /></span>
                  <span className="row__main">
                    <strong>{request.topic}</strong>
                    <span className="num">{t(supportCategoryKeys[request.category])} · {format.dateTime(new Date(request.createdAt).toISOString())}</span>
                    <span className={`pill pill--${badge.tone}`}>{t(badge.label)}</span>
                  </span>
                  <Icon name="chevron-right" size="sm" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </>
  );
}

function activityLabel(item: ActivityItem, t: ReturnType<typeof useI18n>["t"]): string {
  if (item.kind === "quote_previewed") return t("activity.quoteTitle", { from: item.from, to: item.to });
  if (item.kind === "address_screened") return t("activity.screeningTitle", { target: screeningTargetOf(item.asset, item.network)?.label ?? item.asset });
  return t(activityKindKeys[item.kind]);
}

function SupportForm({ heading, onCancel, onCreated }: HeadingProps & {
  onCancel: () => void;
  onCreated: (request: SupportRequestView) => void;
}) {
  const [category, setCategory] = useState<SupportCategory>("question");
  const [topic, setTopic] = useState("");
  const [message, setMessage] = useState("");
  const [activityId, setActivityId] = useState("");
  const [activity, setActivity] = useState<readonly ActivityItem[]>([]);
  const [errors, setErrors] = useState<Partial<Record<Field, MessageKey>>>({});
  const [formError, setFormError] = useState<MessageKey | undefined>();
  const [busy, setBusy] = useState(false);
  const fields = { topic: useRef<HTMLInputElement>(null), message: useRef<HTMLTextAreaElement>(null), activityId: useRef<HTMLSelectElement>(null) };
  const ids = {
    category: useId(),
    topic: useId(),
    topicCount: useId(),
    topicError: useId(),
    message: useId(),
    messageCount: useId(),
    messageError: useId(),
    activity: useId(),
    activityError: useId(),
    formError: useId()
  };
  const { t, format } = useI18n();

  useEffect(() => {
    let active = true;
    api.activity()
      .then((view) => { if (active) setActivity(view.items.filter((item) => item.kind !== "support_requested").slice(0, 20)); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  const fail = (field: Field, key: MessageKey) => {
    setErrors({ [field]: key });
    fields[field].current?.focus();
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrors({});
    setFormError(undefined);
    if (!isValidSupportTopic(topic)) return fail("topic", "support.errorTopic");
    if (!isValidSupportMessage(message)) return fail("message", "support.errorMessage");
    setBusy(true);
    api.createSupportRequest(category, topic.trim(), message.trim(), activityId || undefined)
      .then(onCreated)
      .catch((reason: unknown) => {
        if (reason instanceof ApiError) {
          const fieldKey = messageKeyFor(fieldErrors, reason.code);
          if (fieldKey && Object.hasOwn(fieldOfError, reason.code)) return fail(fieldOfError[reason.code], fieldKey);
          setFormError(messageKeyFor(formErrors, reason.code) ?? "support.errorFailed");
          return;
        }
        setFormError("common.serverUnreachable");
      })
      .finally(() => setBusy(false));
  };

  return (
    <form noValidate onSubmit={submit} aria-describedby={ids.formError}>
      <h3 className="section-label" ref={heading} tabIndex={-1}>{t("support.formTitle")}</h3>
      <p className="sheet__note">{t("support.safety")}</p>
      <label className="form-control" htmlFor={ids.category}>
        <span>{t("support.categoryLabel")}</span>
        <select id={ids.category} value={category} onChange={(event) => setCategory(event.target.value as SupportCategory)}>
          {supportCategories.map((value) => <option key={value} value={value}>{t(supportCategoryKeys[value])}</option>)}
        </select>
      </label>
      <label className="form-control" htmlFor={ids.topic}>
        <span>{t("support.topicLabel")}</span>
        <input
          id={ids.topic}
          ref={fields.topic}
          value={topic}
          maxLength={maxSupportTopicLength}
          autoComplete="off"
          aria-invalid={errors.topic !== undefined}
          aria-describedby={`${ids.topicError} ${ids.topicCount}`}
          onChange={(event) => setTopic(event.target.value)}
        />
        <span className="form-control__hint num" id={ids.topicCount}>{t("support.counter", { count: topic.length, max: maxSupportTopicLength })}</span>
      </label>
      <p className="form-error" id={ids.topicError} aria-live="polite">{errors.topic ? t(errors.topic, { max: maxSupportTopicLength }) : ""}</p>
      <label className="form-control" htmlFor={ids.message}>
        <span>{t("support.messageLabel")}</span>
        <textarea
          id={ids.message}
          ref={fields.message}
          value={message}
          rows={6}
          maxLength={maxSupportMessageLength}
          aria-invalid={errors.message !== undefined}
          aria-describedby={`${ids.messageError} ${ids.messageCount}`}
          onChange={(event) => setMessage(event.target.value)}
        />
        <span className="form-control__hint num" id={ids.messageCount}>{t("support.counter", { count: message.length, max: maxSupportMessageLength })}</span>
      </label>
      <p className="form-error" id={ids.messageError} aria-live="polite">{errors.message ? t(errors.message, { max: maxSupportMessageLength }) : ""}</p>
      <label className="form-control" htmlFor={ids.activity}>
        <span>{t("support.referenceLabel")}</span>
        <select
          id={ids.activity}
          ref={fields.activityId}
          value={activityId}
          aria-invalid={errors.activityId !== undefined}
          aria-describedby={ids.activityError}
          onChange={(event) => setActivityId(event.target.value)}
        >
          <option value="">{t("support.referenceNone")}</option>
          {activity.map((item) => (
            <option key={item.id} value={item.id}>{activityLabel(item, t)} · {format.dateTime(new Date(item.at).toISOString())}</option>
          ))}
        </select>
      </label>
      <p className="form-error" id={ids.activityError} aria-live="polite">{errors.activityId ? t(errors.activityId) : ""}</p>
      {category === "complaint" ? <p className="sheet__note">{t("support.complaintHint")}</p> : null}
      <p className="form-error" id={ids.formError} aria-live="polite">{formError ? t(formError) : ""}</p>
      <div className="sheet__actions sheet__actions--split">
        <button type="submit" className="cta" disabled={busy}>{busy ? t("common.loading") : t("support.submit")}</button>
        <button type="button" className="cta cta--ghost" onClick={onCancel}>{t("support.back")}</button>
      </div>
    </form>
  );
}

function SupportDetail({ heading, request, onBack }: HeadingProps & { request: SupportRequestView; onBack: () => void }) {
  const { t, format } = useI18n();
  const when = (at: number) => format.dateTime(new Date(at).toISOString());
  const badge = statusBadges[request.status];
  const reached = (status: SupportStatus) => request.timeline.find((entry) => entry.status === status);
  const resolved = reached("answered") ?? reached("closed");
  const steps: readonly { title: MessageKey; detail: MessageKey; at?: number; state: string }[] = [
    { title: "support.statusReceived", detail: "support.stepReceived", at: reached("received")?.at, state: "done" },
    {
      title: "support.statusInReview",
      detail: "support.stepReview",
      at: reached("in_review")?.at,
      state: reached("in_review") ? (resolved ? "done" : "current") : "pending"
    },
    {
      title: resolved ? statusBadges[resolved.status].label : "support.stepResolvedTitle",
      detail: "support.stepResolved",
      at: resolved?.at,
      state: resolved ? "done" : "pending"
    }
  ];
  return (
    <>
      {request.complaintAcknowledged ? (
        <div className="support-ack">
          <strong>{t("support.complaintTitle")}</strong>
          <p>{t("support.complaintAck")}</p>
        </div>
      ) : null}
      <h3 className="section-label" ref={heading} tabIndex={-1}>{request.topic}</h3>
      <dl className="meta-list">
        <div><dt>{t("support.categoryLabel")}</dt><dd>{t(supportCategoryKeys[request.category])}</dd></div>
        <div><dt>{t("support.statusLabel")}</dt><dd><span className={`pill pill--${badge.tone}`}>{t(badge.label)}</span></dd></div>
        <div><dt>{t("support.createdLabel")}</dt><dd className="num">{when(request.createdAt)}</dd></div>
        {request.activityRef ? <div><dt>{t("support.referenceValue")}</dt><dd>{t(activityKindKeys[request.activityRef.kind])}</dd></div> : null}
        <div><dt>{t("support.storedUntil")}</dt><dd className="num">{when(request.expiresAt)}</dd></div>
      </dl>
      <h3 className="section-label">{t("support.messageLabel")}</h3>
      <p className="support-message">{request.message}</p>
      <h3 className="section-label">{t("support.timelineLabel")}</h3>
      <ol className="timeline">
        {steps.map((step) => (
          <li key={step.detail} className={`timeline__step is-${step.state}`}>
            <span className="timeline__mark">
              <Icon name={step.state === "done" ? "check" : "clock"} size="xs" />
            </span>
            <span>
              <strong>{t(step.title)}</strong>
              <span>{t(step.detail)}{step.at ? ` · ${when(step.at)}` : ""}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="sheet__note">{t("support.noOperator")}</p>
      <button type="button" className="cta cta--ghost" onClick={onBack}>{t("support.back")}</button>
    </>
  );
}
