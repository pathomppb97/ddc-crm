export interface FeatureFlagRecord {
  flagKey: string;
  isEnabled: boolean;
  killSwitch: boolean;
  rolloutPercentage: number;
  targetUserIds: number[];
  targetRoleKeys: string[];
  targetTeamIds: number[];
  scheduledEnableAt?: string | null;
  scheduledDisableAt?: string | null;
}

export interface FeatureFlagContext {
  salesId?: number | null;
  roleKey?: string | null;
  teamIds?: number[];
  nowUtc?: Date;
}

export interface FeatureFlagEvaluation {
  flagKey: string;
  enabled: boolean;
  reason:
    | "kill_switch"
    | "disabled"
    | "outside_schedule"
    | "user_target"
    | "role_target"
    | "team_target"
    | "percentage_rollout"
    | "default_off";
}

/** Stable deterministic 0..99 bucket using 32-bit FNV-1a hash. */
export function stableRolloutBucket(
  flagKey: string,
  subjectId: string,
): number {
  const input = `${flagKey}:${subjectId}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 100;
}

/**
 * Evaluates a runtime feature flag.
 * NOTE: Feature flags NEVER replace server-side authorization.
 */
export function evaluateFeatureFlag(
  flag: FeatureFlagRecord,
  ctx: FeatureFlagContext,
): FeatureFlagEvaluation {
  if (flag.killSwitch) {
    return { flagKey: flag.flagKey, enabled: false, reason: "kill_switch" };
  }
  if (!flag.isEnabled) {
    return { flagKey: flag.flagKey, enabled: false, reason: "disabled" };
  }

  const nowMs = (ctx.nowUtc ?? new Date()).getTime();
  if (flag.scheduledEnableAt && nowMs < Date.parse(flag.scheduledEnableAt)) {
    return {
      flagKey: flag.flagKey,
      enabled: false,
      reason: "outside_schedule",
    };
  }
  if (flag.scheduledDisableAt && nowMs >= Date.parse(flag.scheduledDisableAt)) {
    return {
      flagKey: flag.flagKey,
      enabled: false,
      reason: "outside_schedule",
    };
  }

  if (
    ctx.salesId !== null &&
    ctx.salesId !== undefined &&
    flag.targetUserIds.includes(ctx.salesId)
  ) {
    return { flagKey: flag.flagKey, enabled: true, reason: "user_target" };
  }

  if (ctx.roleKey && flag.targetRoleKeys.includes(ctx.roleKey)) {
    return { flagKey: flag.flagKey, enabled: true, reason: "role_target" };
  }

  if (ctx.teamIds?.some((tid) => flag.targetTeamIds.includes(tid))) {
    return { flagKey: flag.flagKey, enabled: true, reason: "team_target" };
  }

  const pct = Math.max(0, Math.min(100, Math.trunc(flag.rolloutPercentage)));
  if (pct === 100) {
    return {
      flagKey: flag.flagKey,
      enabled: true,
      reason: "percentage_rollout",
    };
  }
  if (pct > 0 && ctx.salesId !== null && ctx.salesId !== undefined) {
    const bucket = stableRolloutBucket(flag.flagKey, String(ctx.salesId));
    if (bucket < pct) {
      return {
        flagKey: flag.flagKey,
        enabled: true,
        reason: "percentage_rollout",
      };
    }
  }

  return { flagKey: flag.flagKey, enabled: false, reason: "default_off" };
}
