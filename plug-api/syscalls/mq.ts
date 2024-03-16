import { syscall } from "../syscall.ts";
import type { MQStats } from "../types.ts";

export function send(queue: string, body: any) {
  return syscall("mq.send", queue, body);
}

export function batchSend(queue: string, bodies: any[]) {
  return syscall("mq.batchSend", queue, bodies);
}

export function ack(queue: string, id: string) {
  return syscall("mq.ack", queue, id);
}

export function batchAck(queue: string, ids: string[]) {
  return syscall("mq.batchAck", queue, ids);
}

export function getQueueStats(queue: string): Promise<MQStats> {
  return syscall("mq.getQueueStats", queue);
}
