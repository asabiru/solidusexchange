import type { MarketDepthView } from "../shared/api.js";

/**
 * The contract caps the served ladder: `depthLevels` reports the deeper
 * side's level count before the cap applied, so the book renders
 * truncated exactly when that count exceeds the served side.
 */
export function depthTruncated(
  depth: Pick<MarketDepthView, "bids" | "asks" | "depthLevels">
): boolean {
  return depth.depthLevels > Math.max(depth.bids.length, depth.asks.length);
}
