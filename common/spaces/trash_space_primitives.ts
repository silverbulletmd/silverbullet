import { Plug } from "../../plugos/plug.ts";
import { FileMeta } from "../types.ts";
import { FileData, FileEncoding, SpacePrimitives } from "./space_primitives.ts";

export class TrashSpacePrimitives implements SpacePrimitives {
  constructor(
    readonly wrapped: SpacePrimitives,
    readonly prefix: string,
    private timeskew = 0,
  ) {
  }

  async fetchFileList(): Promise<{ files: FileMeta[]; timestamp: number }> {
    const { files, timestamp } = await this.wrapped.fetchFileList();
    return { files, timestamp: timestamp + this.timeskew };
  }

  public async seggregateFileList(): Promise<
    { files: FileMeta[]; trashFiles: FileMeta[]; timestamp: number }
  > {
    const { files, timestamp } = await this.fetchFileList();
    return {
      files: files.filter((f) => !f.name.startsWith(this.prefix)),
      trashFiles: files.filter((f) => f.name.startsWith(this.prefix)).map(
        // Chop off the prefix
        (f) => ({ ...f, name: f.name.substring(this.prefix.length) }),
      ),
      timestamp,
    };
  }

  readFile(
    name: string,
    encoding: FileEncoding,
  ): Promise<{ data: FileData; meta: FileMeta }> {
    return this.wrapped.readFile(name, encoding);
  }

  getFileMeta(name: string): Promise<FileMeta> {
    return this.wrapped.getFileMeta(name);
  }

  writeFile(
    name: string,
    encoding: FileEncoding,
    data: FileData,
    selfUpdate?: boolean | undefined,
    timestamp?: number | undefined,
  ): Promise<FileMeta> {
    return this.wrapped.writeFile(
      name,
      encoding,
      data,
      selfUpdate,
      timestamp || this.timeskew && Date.now() + this.timeskew,
    );
  }

  async deleteFile(
    name: string,
    timestamp?: number,
  ): Promise<void> {
    const fileData = await this.readFile(name, "arraybuffer");
    // Move to trash
    await this.writeFile(
      `${this.prefix}${name}`,
      "arraybuffer",
      fileData.data,
      true,
      timestamp,
    );

    return this.wrapped.deleteFile(name);
  }

  proxySyscall(plug: Plug<any>, name: string, args: any[]): Promise<any> {
    return this.wrapped.proxySyscall(plug, name, args);
  }
  invokeFunction(
    plug: Plug<any>,
    env: string,
    name: string,
    args: any[],
  ): Promise<any> {
    return this.wrapped.invokeFunction(plug, env, name, args);
  }
}
