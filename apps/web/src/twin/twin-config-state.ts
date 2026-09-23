import type { TwinDriveConfig } from "../../../../shared/twin-drive";

/** Pure local update: disabling the drive must also disable its automatic source. */
export function withTwinDriveEnabled(config: TwinDriveConfig, enabled: boolean): TwinDriveConfig {
  return {
    ...config,
    enabled,
    ...(!enabled && config.simulation ? { simulation: { ...config.simulation, enabled: false } } : {}),
  };
}
