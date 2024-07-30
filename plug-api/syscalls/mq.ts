import { syscall } from "../syscall.ts";
import type { MQStats } from "../types.ts";

export function send(queue: string, body: any): Promise<void> {
  return syscall("mq.send", queue, body);
}

export function batchSend(queue: string, bodies: any[]): Promise<void> {
  return syscall("mq.batchSend", queue, bodies);
}

export function ack(queue: string, id: string): Promise<void> {
  return syscall("mq.ack", queue, id);
}

export function batchAck(queue: string, ids: string[]): Promise<void> {
  return syscall("mq.batchAck", queue, ids);
}

export function getQueueStats(queue: string): Promise<MQStats> {
  return syscall("mq.getQueueStats", queue);
}
