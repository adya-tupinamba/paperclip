export function isFeatureIlmV2Enabled(): boolean {
  const v = process.env.PAPERCLIP_FEATURE_ILM_V2?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}
