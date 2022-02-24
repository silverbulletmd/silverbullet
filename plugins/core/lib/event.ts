import {syscall} from "./syscall.ts";

export async function publish(event: string, data?: object) {
    return await syscall("event.publish", event, data);
}
