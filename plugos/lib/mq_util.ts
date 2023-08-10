// Adds a plug name to a queue name if it doesn't already have one.
export function fullQueueName(plugName: string, queueName: string) {
  if (queueName.includes(".")) {
    return queueName;
  }
  return plugName + "." + queueName;
}
