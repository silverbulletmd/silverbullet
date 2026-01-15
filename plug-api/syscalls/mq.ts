import { syscall } from "../syscall.ts";

import type { MQStats } from "../../plug-api/types/datastore.ts";

/**
 * Implements a simple Message Queue system.
 * @module
 */

/**
 * Sends a message to a queue.
 * @param queue the name of the queue to send the message to
 * @param body the body of the message to send
 */
export function send(queue: string, body: any): Promise<void> {
  return syscall("mq.send", queue, body);
}

/**
 * Sends a batch of messages to a queue.
 * @param queue the name of the queue
 * @param bodies the bodies of the messages to send
 */
export function batchSend(
  queue: string,
  bodies: any[],
): Promise<void> {
  return syscall("mq.batchSend", queue, bodies);
}

/**
 * Flushes all messages from a queue.
 * @param queue the name of the queue to subscribe to
 */
export function flushQueue(queue: string): Promise<void> {
  return syscall("mq.flushQueue", queue);
}

/**
 * Flushes all messages from all queues.
 */
export function flushAllQueues(): Promise<void> {
  return syscall("mq.flushAllQueues");
}

/**
 * Acknowledges a message from a queue, in case it needs to be explicitly acknowledged.
 * @param queue the name of the queue the message came from
 * @param id the id of the message to acknowledge
 */
export function ack(queue: string, id: string): Promise<void> {
  return syscall("mq.ack", queue, id);
}

/**
 * Acknowledges a batch of messages from a queue, in case they need to be explicitly acknowledged.
 * @param queue the name of the queue the messages came from
 * @param ids the ids of the messages to acknowledge
 */
export function batchAck(queue: string, ids: string[]): Promise<void> {
  return syscall("mq.batchAck", queue, ids);
}

/**
 * Retrieves stats on a particular queue.
 * @param queue the name of the queue
 */
export function getQueueStats(queue?: string): Promise<MQStats> {
  return syscall("mq.getQueueStats", queue);
}

/**
 * Waits for a queue to become empty.
 * @param queue the name of the queue
 * @returns a promise that resolves when the queue is empty
 */
export function awaitEmptyQueue(queue: string): Promise<void> {
  return syscall("mq.awaitEmptyQueue", queue);
}
