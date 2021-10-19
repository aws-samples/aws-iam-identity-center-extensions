// Re-usable function to apply watchful construct for all supported resources within the scope
import { Construct } from "@aws-cdk/core";
import { Watchful } from "cdk-watchful";

export function watch(construct: Construct, applicationName: string) {
  const watchful = new Watchful(construct, applicationName, {
    dashboardName: applicationName,
  });

  watchful.watchScope(construct);
}
