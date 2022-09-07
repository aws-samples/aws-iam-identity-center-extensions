# 2. Continuous Sync For Permission Sets

Date: 2022-09-07

## Status

Proposed

## Context

When permission sets are created/updated/deleted through interfaces outside the solution i.e. console , SDK etc, the solution is not made aware of this change. This would result in a stale data scenario where the solution's version of the permission set is different to what it was in the AWS IAM Identity Center instance, often resulting in a deadlock situation where the solution user cannot manage/ cannot correctly manage this permission set through the solution interfaces.

## Decision

To handle this, we intend to have continuous sync for permission sets where in , through event bridge rules we listen on the following types of permission set changes, and update solution's repository to be aware of these changes and ensure that the permission set CRUD flow triggered through the solution interfaces is in line with these changes. We will import all changes from all permission sets as part of these continous sync operations

1. Permission set create/update/delete operation
2. Permission set managed policy changes - AWS and customer
3. Permission set inline policy changes
4. Permission set permissions boundary changes
5. Permission set tags changes

## Consequences

This change will bring permission sets provisioned/managed outside the solution into the scope of the solution. It would allow solution users to provision account assignments to these imported permission sets and manage these imported permission sets through solution interfaces as well.
