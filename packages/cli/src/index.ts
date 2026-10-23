// @composurejs/cli as a library: Sync for custom front ends and deploy scripts.
export { defaultEntry, type LoadedApp, loadApp } from "./load.ts";
export {
  APPLICATION_ID_VAR,
  apply,
  type Change,
  type ChangeKind,
  configFromEnv,
  counts,
  type Definition,
  formatPlan,
  hasChanges,
  label,
  plan,
  planTarget,
  same,
  SCOPE_VAR_PREFIX,
  scopeKey,
  SyncError,
  type SyncConfig,
  type SyncPlan,
  type Target,
  type TargetPlan,
  targets,
  TOKEN_VAR,
} from "composurejs/sync";
export { main, sync, type Io, type SyncOptions } from "./cli.ts";
export { clackUi, recordingUi, type Ui } from "./ui.ts";
export { type PlanStyle, summary } from "composurejs/sync";
