# 3. Continuous sync for Account Assignments

Date: 2022-09-07

## Status

Proposed

## Context

When account assignments are created/deleted through interfaces outside the solution i.e. console , SDK etc, the solution is not made aware of this change. This would result in a stale data scenario where the solution's version of the account assignment is different to waht it was in the AWS IAM Identity Center instance, resulting in either an invalid account assignment create/delet operation

## Decision

To handle this, we intend to have continous sync for account assignments where in, through event bridge rules we listen on the following types of account assignment changes, and update solution's repository to be aware of these changes and ensure that the account assignment create/delete flow triggered through the solution intefaces is in line with these changes. We will import all create/delete account assignments as part of these continuous sync operations

## Consequences

This change will bring account assignments created/deleted outside the solution into the scope of the solution.
