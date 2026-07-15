import type { Hook, Manifest } from "../types.ts";
import type { SysCallMapping, SyscallContext, System } from "../system.ts";
import type { SyscallHookT } from "@silverbulletmd/silverbullet/type/manifest";

export class SyscallHook implements Hook<SyscallHookT> {
  apply(system: System<SyscallHookT>): void {
    this.registerSyscalls(system);
    system.on({
      plugLoaded: () => {
        this.registerSyscalls(system);
      },
    });
  }

  registerSyscalls(system: System<SyscallHookT>) {
    // Register syscalls from all loaded plugs
    for (const plug of system.loadedPlugs.values()) {
      const syscalls: SysCallMapping = {};

      for (const [name, functionDef] of Object.entries(
        plug.manifest!.functions,
      )) {
        if (!functionDef.syscall) {
          continue;
        }

        const syscallDefinition = functionDef.syscall;
        const syscallName =
          typeof syscallDefinition === "string"
            ? syscallDefinition
            : syscallDefinition.name;

        // Add the syscall to our mapping
        const callback = (ctx: SyscallContext, ...args: any[]) =>
          system.syscall(ctx, "system.invokeFunction", [
            `${plug.manifest!.name}.${name}`,
            ...args,
          ]);
        syscalls[syscallName] =
          typeof syscallDefinition === "string"
            ? callback
            : {
                callback,
                documentation: {
                  description: syscallDefinition.description,
                  parameters: syscallDefinition.parameters,
                  returns: syscallDefinition.returns,
                  deprecated: syscallDefinition.deprecated,
                  see: syscallDefinition.see,
                },
              };

        // Register the syscalls with no required permissions
        system.registerSyscalls([], syscalls);
      }
    }
  }

  validateManifest(manifest: Manifest<SyscallHookT>): string[] {
    const errors: string[] = [];
    for (const [name, functionDef] of Object.entries(manifest.functions)) {
      if (!functionDef.syscall) {
        continue;
      }

      const syscallName =
        typeof functionDef.syscall === "string"
          ? functionDef.syscall
          : functionDef.syscall.name;
      if (!syscallName) {
        errors.push(`Function ${name} has a syscall but no name`);
        continue;
      }

      // Validate syscall name format (should be namespaced)
      if (!syscallName.includes(".")) {
        errors.push(
          `Function ${name} has invalid syscall name "${syscallName}" - must be in format "namespace.name"`,
        );
      }
    }
    return errors;
  }
}
