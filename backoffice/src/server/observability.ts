import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

export type LogMode = "off" | "json";
export type MetricsMode = "off" | "loopback";

export interface ObservabilityConfig {
  log: LogMode;
  metrics: MetricsMode;
}

export interface Gauge {
  name: string;
  help: string;
  value: () => number | undefined | Promise<number | undefined>;
}

export interface RequestObserverOptions {
  service: string;
  /** Route templates from the frozen route table; `:param` matches one segment. */
  routes: readonly string[];
  config?: ObservabilityConfig;
  sink?: (line: string) => void;
  /** Monotonic milliseconds. */
  timer?: () => number;
  wallClock?: () => number;
}

export interface RequestObserver {
  readonly metricsEnabled: boolean;
  routeOf(path: string): string;
  observe(request: IncomingMessage, response: ServerResponse): string;
  renderMetrics(gauges?: readonly Gauge[]): Promise<string>;
}

interface Histogram {
  buckets: number[];
  sum: number;
  count: number;
}

export const observabilityOff: ObservabilityConfig = Object.freeze({ log: "off", metrics: "off" });
export const logModes: readonly LogMode[] = Object.freeze(["off", "json"]);
export const metricsModes: readonly MetricsMode[] = Object.freeze(["off", "loopback"]);
export const unmatchedRoute = "unmatched";
export const durationBucketsSeconds: readonly number[] = Object.freeze([
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5
]);
export const methodLabels: readonly string[] = Object.freeze([
  "GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"
]);
export const metricsContentType = "text/plain; version=0.0.4; charset=utf-8";

const requestsMetric = "solidchange_http_requests_total";
const durationMetric = "solidchange_http_request_duration_seconds";
const separator = "\u0000";

function templatePattern(template: string): RegExp {
  const segments = template.split("/").map((segment) => segment.startsWith(":")
    ? "[^/]+"
    : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^${segments.join("/")}$`);
}

function methodLabel(method: string | undefined): string {
  return method !== undefined && methodLabels.includes(method) ? method : "OTHER";
}

function statusClass(status: number): string {
  return Number.isInteger(status) && status >= 100 && status < 600 ? `${Math.floor(status / 100)}xx` : "other";
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function labels(values: Readonly<Record<string, string>>): string {
  return `{${Object.entries(values).map(([name, value]) => `${name}="${escapeLabel(value)}"`).join(",")}}`;
}

function formatNumber(value: number): string {
  return String(Number(value.toFixed(6)));
}

function isLoopbackPeer(address: string | undefined): boolean {
  if (address === undefined) return false;
  const ipv4 = address.startsWith("::ffff:") ? address.slice("::ffff:".length) : address;
  return address === "::1" || /^127\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$/.test(ipv4);
}

function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return false;
  const hostname = host.startsWith("[") ? host.slice(1, host.indexOf("]")) : host.split(":")[0];
  return hostname === "localhost" || hostname === "::1" || /^127\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$/.test(hostname);
}

/**
 * Metrics are for a developer on the same machine: loopback peer and Host,
 * no browser cross-site context and no proxy hop (the Vite proxy also blocks
 * the path, see vite.config.ts).
 */
export function metricsRequestAllowed(request: IncomingMessage): boolean {
  const { headers } = request;
  if (!isLoopbackPeer(request.socket.remoteAddress) || !isLoopbackHost(headers.host)) return false;
  if (headers.origin !== undefined || headers.forwarded !== undefined || headers.via !== undefined) return false;
  if (Object.keys(headers).some((name) => name.startsWith("x-forwarded-"))) return false;
  const fetchSite = headers["sec-fetch-site"];
  return fetchSite === undefined || fetchSite === "none";
}

function pathnameOf(url: string | undefined): string | undefined {
  try {
    return new URL(url ?? "/", "http://127.0.0.1").pathname;
  } catch {
    return undefined;
  }
}

/**
 * Dev-only request logging and in-memory metrics. Log lines and labels only
 * carry the route template, method label, status and a server-generated id:
 * never headers, cookies, bodies, query strings, subjects or peer addresses.
 */
export function createRequestObserver(options: RequestObserverOptions): RequestObserver {
  const config = options.config ?? observabilityOff;
  const timer = options.timer ?? (() => performance.now());
  const wallClock = options.wallClock ?? Date.now;
  const sink = options.sink ?? ((line: string) => {
    process.stdout.write(`${line}\n`);
  });
  const templates = Object.freeze([...new Set(options.routes)].map((template) => ({
    template,
    pattern: templatePattern(template)
  })));
  const counters = new Map<string, number>();
  const histograms = new Map<string, Histogram>();

  function routeOf(path: string): string {
    return templates.find(({ pattern }) => pattern.test(path))?.template ?? unmatchedRoute;
  }

  function record(method: string, route: string, status: number, durationMs: number): void {
    const counterKey = [route, method, statusClass(status)].join(separator);
    counters.set(counterKey, (counters.get(counterKey) ?? 0) + 1);
    const histogramKey = [route, method].join(separator);
    let histogram = histograms.get(histogramKey);
    if (!histogram) {
      histogram = { buckets: durationBucketsSeconds.map(() => 0), sum: 0, count: 0 };
      histograms.set(histogramKey, histogram);
    }
    const seconds = durationMs / 1_000;
    durationBucketsSeconds.forEach((bound, index) => {
      if (seconds <= bound) (histogram as Histogram).buckets[index] += 1;
    });
    histogram.sum += seconds;
    histogram.count += 1;
  }

  function observe(request: IncomingMessage, response: ServerResponse): string {
    const requestId = randomBytes(16).toString("hex");
    const started = timer();
    const method = methodLabel(request.method);
    const path = pathnameOf(request.url);
    const route = path === undefined ? unmatchedRoute : routeOf(path);
    response.setHeader("x-request-id", requestId);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      const durationMs = Math.max(0, timer() - started);
      const status = response.statusCode;
      if (config.metrics === "loopback") record(method, route, status, durationMs);
      if (config.log === "json") {
        sink(JSON.stringify({
          ts: new Date(wallClock()).toISOString(),
          service: options.service,
          method,
          route,
          status,
          duration_ms: Number(durationMs.toFixed(3)),
          request_id: requestId
        }));
      }
    };
    response.once("finish", finish);
    response.once("close", finish);
    return requestId;
  }

  async function renderMetrics(gauges: readonly Gauge[] = []): Promise<string> {
    const service = options.service;
    const lines = [
      `# HELP ${requestsMetric} Completed HTTP requests by route template, method and status class.`,
      `# TYPE ${requestsMetric} counter`
    ];
    for (const [key, value] of [...counters].sort(([a], [b]) => a.localeCompare(b))) {
      const [route, method, status_class] = key.split(separator);
      lines.push(`${requestsMetric}${labels({ service, route, method, status_class })} ${value}`);
    }
    lines.push(
      `# HELP ${durationMetric} HTTP request duration in seconds.`,
      `# TYPE ${durationMetric} histogram`
    );
    for (const [key, histogram] of [...histograms].sort(([a], [b]) => a.localeCompare(b))) {
      const [route, method] = key.split(separator);
      durationBucketsSeconds.forEach((bound, index) => {
        lines.push(`${durationMetric}_bucket${labels({ service, route, method, le: String(bound) })} ${histogram.buckets[index]}`);
      });
      lines.push(
        `${durationMetric}_bucket${labels({ service, route, method, le: "+Inf" })} ${histogram.count}`,
        `${durationMetric}_sum${labels({ service, route, method })} ${formatNumber(histogram.sum)}`,
        `${durationMetric}_count${labels({ service, route, method })} ${histogram.count}`
      );
    }
    for (const gauge of gauges) {
      const value = await gauge.value();
      if (value === undefined || !Number.isFinite(value)) continue;
      lines.push(`# HELP ${gauge.name} ${gauge.help}`, `# TYPE ${gauge.name} gauge`, `${gauge.name}${labels({ service })} ${value}`);
    }
    return `${lines.join("\n")}\n`;
  }

  return Object.freeze({
    metricsEnabled: config.metrics === "loopback",
    routeOf,
    observe,
    renderMetrics
  });
}
