import { randomBytes } from "node:crypto";

export const LOG_MODES = Object.freeze(["off", "json"]);
export const METRICS_MODES = Object.freeze(["off", "loopback"]);
export const METRICS_PATH = "/metrics";
export const UNMATCHED_ROUTE = "unmatched";
export const DURATION_BUCKETS_SECONDS = Object.freeze([0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]);
export const METHOD_LABELS = Object.freeze(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
export const METRICS_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";

const REQUESTS_METRIC = "solidchange_http_requests_total";
const DURATION_METRIC = "solidchange_http_request_duration_seconds";
const SEPARATOR = "\u0000";
const IPV4_LOOPBACK_PATTERN = /^(?:::ffff:)?127\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$/iu;

function methodLabel(method) {
  return METHOD_LABELS.includes(method) ? method : "OTHER";
}

function statusClass(status) {
  return Number.isInteger(status) && status >= 100 && status < 600 ? `${Math.floor(status / 100)}xx` : "other";
}

function escapeLabel(value) {
  return value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"').replace(/\n/gu, "\\n");
}

function labels(values) {
  return `{${Object.entries(values).map(([name, value]) => `${name}="${escapeLabel(value)}"`).join(",")}}`;
}

function isLoopbackPeer(address) {
  return address === "::1" || (typeof address === "string" && IPV4_LOOPBACK_PATTERN.test(address));
}

function isLoopbackHost(host) {
  if (typeof host !== "string" || host === "") {
    return false;
  }
  const hostname = host.startsWith("[") ? host.slice(1, host.indexOf("]")) : host.split(":")[0];
  return hostname === "localhost" || hostname === "::1" || IPV4_LOOPBACK_PATTERN.test(hostname);
}

/**
 * Metrics are for a developer on the same machine: loopback peer and Host,
 * no browser cross-site context and no proxy hop.
 */
export function metricsRequestAllowed(request, headers) {
  const host = headers.get("host");
  if (!isLoopbackPeer(request.socket.remoteAddress) || host?.length !== 1 || !isLoopbackHost(host[0])) {
    return false;
  }
  if (headers.has("origin") || headers.has("forwarded") || headers.has("via")) {
    return false;
  }
  if ([...headers.keys()].some((name) => name.startsWith("x-forwarded-"))) {
    return false;
  }
  const fetchSite = headers.get("sec-fetch-site");
  return fetchSite === undefined || (fetchSite.length === 1 && fetchSite[0] === "none");
}

/**
 * Dev-only request logging and in-memory metrics. Log lines and labels only
 * carry the route template, method label, status and a server-generated id:
 * never headers, tokens, bodies, query strings, subjects or peer addresses.
 */
export function createRequestObserver({
  service,
  routes,
  config = { log: "off", metrics: "off" },
  sink = (line) => process.stdout.write(`${line}\n`),
  timer = () => performance.now(),
  wallClock = () => Date.now()
}) {
  const templates = new Set(routes);
  const counters = new Map();
  const histograms = new Map();
  const metricsEnabled = config.metrics === "loopback";

  function routeOf(url) {
    return templates.has(url) ? url : UNMATCHED_ROUTE;
  }

  function complete(method, route, status, durationMs) {
    const requestId = randomBytes(16).toString("hex");
    if (metricsEnabled) {
      const counterKey = [route, method, statusClass(status)].join(SEPARATOR);
      counters.set(counterKey, (counters.get(counterKey) ?? 0) + 1);
      const histogramKey = [route, method].join(SEPARATOR);
      let histogram = histograms.get(histogramKey);
      if (!histogram) {
        histogram = { buckets: DURATION_BUCKETS_SECONDS.map(() => 0), sum: 0, count: 0 };
        histograms.set(histogramKey, histogram);
      }
      const seconds = durationMs / 1_000;
      DURATION_BUCKETS_SECONDS.forEach((bound, index) => {
        if (seconds <= bound) {
          histogram.buckets[index] += 1;
        }
      });
      histogram.sum += seconds;
      histogram.count += 1;
    }
    if (config.log === "json") {
      sink(
        JSON.stringify({
          ts: new Date(wallClock()).toISOString(),
          service,
          method,
          route,
          status,
          duration_ms: Number(durationMs.toFixed(3)),
          request_id: requestId
        })
      );
    }
  }

  function observe(request, response) {
    const started = timer();
    const method = methodLabel(request.method);
    const route = routeOf(request.url);
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        complete(method, route, response.statusCode, Math.max(0, timer() - started));
      }
    };
    response.once("finish", finish);
    response.once("close", finish);
  }

  function recordRejected(status) {
    complete("OTHER", UNMATCHED_ROUTE, status, 0);
  }

  function renderMetrics() {
    const lines = [
      `# HELP ${REQUESTS_METRIC} Completed HTTP requests by route template, method and status class.`,
      `# TYPE ${REQUESTS_METRIC} counter`
    ];
    for (const [key, value] of [...counters].sort(([a], [b]) => a.localeCompare(b))) {
      const [route, method, status_class] = key.split(SEPARATOR);
      lines.push(`${REQUESTS_METRIC}${labels({ service, route, method, status_class })} ${value}`);
    }
    lines.push(`# HELP ${DURATION_METRIC} HTTP request duration in seconds.`, `# TYPE ${DURATION_METRIC} histogram`);
    for (const [key, histogram] of [...histograms].sort(([a], [b]) => a.localeCompare(b))) {
      const [route, method] = key.split(SEPARATOR);
      DURATION_BUCKETS_SECONDS.forEach((bound, index) => {
        lines.push(`${DURATION_METRIC}_bucket${labels({ service, route, method, le: String(bound) })} ${histogram.buckets[index]}`);
      });
      lines.push(
        `${DURATION_METRIC}_bucket${labels({ service, route, method, le: "+Inf" })} ${histogram.count}`,
        `${DURATION_METRIC}_sum${labels({ service, route, method })} ${Number(histogram.sum.toFixed(6))}`,
        `${DURATION_METRIC}_count${labels({ service, route, method })} ${histogram.count}`
      );
    }
    return `${lines.join("\n")}\n`;
  }

  return Object.freeze({ metricsEnabled, routeOf, observe, recordRejected, renderMetrics });
}
