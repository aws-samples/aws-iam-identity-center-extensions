/**
 * Utility function ensures a describe call on a customer managed policy is only
 * run X number of times
 */

import { DescribeOpIterator } from "../../helpers/src/interfaces";

export const handler = async (event: DescribeOpIterator) => {
  console.log(`Full event - ${JSON.stringify(event)}`);
  let index = event.iterator.index;
  const count = event.iterator.count;
  const step = event.iterator.step;

  index = index + step;

  return {
    index: index,
    step: step,
    count: count,
    continue: index < count,
  };
};
