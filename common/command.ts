export const commandLinkRegex =
  /^\{\[([^\]\|]+)(\|([^\]]+))?\](\(([^\)]+)\))?\}/;

export type ParsedCommand = {
  name: string;
  args: any[];
  alias?: string;
};

export function parseCommand(command: string): ParsedCommand {
  const parsedCommand: ParsedCommand = { name: command, args: [] };
  const commandMatch = commandLinkRegex.exec(command);
  if (commandMatch) {
    parsedCommand.name = commandMatch[1];
    if (commandMatch[3]) {
      parsedCommand.alias = commandMatch[3];
    }
    parsedCommand.args = commandMatch[5]
      ? JSON.parse(`[${commandMatch[5]}]`)
      : [];
  }
  return parsedCommand;
}
