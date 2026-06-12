/**
 * Accuracy-drop detector (Dave DoD §8): flags when the newest backtest MAE is
 * meaningfully worse than the prior run, so a degrading forecast is caught
 * instead of silently shipping bad numbers. Pure module.
 */
export function accuracyDropped(
  currentMae: number,
  priorMae: number | null | undefined,
  thresholdPct = 20
): boolean {
  if (priorMae == null || priorMae <= 0) return false; // no baseline to compare
  return (currentMae - priorMae) / priorMae > thresholdPct / 100;
}

/** Human one-liner for the alert body. */
export function accuracyDropMessage(currentMae: number, priorMae: number): string {
  const pct = Math.round(((currentMae - priorMae) / priorMae) * 100);
  return `Forecast accuracy dropped: MAE ${priorMae.toFixed(2)} → ${currentMae.toFixed(2)} (+${pct}%).`;
}
