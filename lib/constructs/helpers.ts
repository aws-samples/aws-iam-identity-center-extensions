/** All helper utilities used by different constructs */

import { BuildConfig } from "../build/buildConfig";

/**
 * Environment specific resource naming function
 *
 * @param buildConfig
 * @param resourcename
 * @returns Environment specific resource name
 */
export function name(buildConfig: BuildConfig, resourcename: string): string {
  return buildConfig.Environment + "-" + resourcename;
}
