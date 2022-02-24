import {syscall} from "./syscall.ts";

export async function put(key: string, value: any) {
    return await syscall("db.put", key, value);
}

export async function get(key: string) {
    return await syscall("db.get", key);
}
