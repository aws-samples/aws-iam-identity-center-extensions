# 4. Region Switch Enhancements

Date: 2022-09-07

## Status

Proposed

## Context

- Region Switch functionality in the solution currently only caters for an on-demand region switch capability. Solution user will need to run a `discover` phase in their current AWS region first, followed by a `deploy` phase in their new AWS region that would allow them to automatically import permission sets and account assignments in the new AWS region
- There's however interest for customers to use the solution's region switch `discover` capability on a continous basis. That is, customers would prefer to deploy the region switch `discover` capability, so that it's continuously in sync with changes in permission sets/account assignments happening on AWS IAM Identity Center instance configuration, allowing them to do a `deploy` on a new AWS region whenever they choose.

## Decision

- To support this, region switch functionality would be extended with the continuous sync features, so that customers can choose `continous-sync` as the region switch flavour
- This will then enable customers to have an up-to-date copy of permisison sets/account assignments that they could choose to `deploy` into a new AWS region at a time of their choosing.

## Consequences

Continous sync feature needs to be de-coupled from the solution to enable it to be deployed both with the core solution as well as region switch components
