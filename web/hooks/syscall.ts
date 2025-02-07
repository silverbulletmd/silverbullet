import type { Hook, Manifest } from "$lib/plugos/types.ts";
import type { System } from "$lib/plugos/system.ts";
import type { SyscallHookT } from "$lib/manifest.ts";
import type { SysCallMapping } from "$lib/plugos/system.ts";

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

      for (
        const [name, functionDef] of Object.entries(plug.manifest!.functions)
      ) {
        if (!functionDef.syscall) {
          continue;
        }

        const syscallName = functionDef.syscall;

        console.log("Registering plug syscall", syscallName, "for", name);
        // Add the syscall to our mapping
        syscalls[syscallName] = (ctx, ...args) => {
          // Delegate to the system to invoke the function
          return system.syscall(ctx, "system.invokeFunction", [
            `${plug.manifest!.name}.${name}`,
            ...args,
          ]);
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

      // Validate syscall name is provided
      if (!functionDef.syscall) {
        errors.push(`Function ${name} has a syscall but no name`);
        continue;
      }

      // Validate syscall name format (should be namespaced)
      if (!functionDef.syscall.includes(".")) {
        errors.push(
          `Function ${name} has invalid syscall name "${functionDef.syscall}" - must be in format "namespace.name"`,
        );
      }
    }
    return errors;
  }
}
