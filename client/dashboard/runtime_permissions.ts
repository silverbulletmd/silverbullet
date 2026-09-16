import type { MemberEntry, SpaceAccess } from "./types.ts";

export function changeMemberAccess(
  member: MemberEntry | undefined,
  access: SpaceAccess,
): MemberEntry | undefined {
  if (access === "none") return undefined;
  return {
    ...member,
    role: access,
    runtimeApi:
      access === "write" &&
      (member?.runtimeApi ?? (member === undefined || member.role === "write")),
  };
}
