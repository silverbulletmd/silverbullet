import type { KvPrimitives } from "../data/kv_primitives.ts";
import type { Plug } from "./plug.ts";
import type { Manifest } from "./types.ts";

export interface ManifestCache<T> {
  getManifest(
    plug: Plug<T>,
    cacheKey: string,
    cacheHash: number,
  ): Promise<Manifest<T>>;
}

export class KVPrimitivesManifestCache<T> implements ManifestCache<T> {
  constructor(private kv: KvPrimitives, private manifestPrefix: string) {
  }

  async getManifest(
    plug: Plug<T>,
    cacheKey: string,
    cacheHash: number,
  ): Promise<Manifest<T>> {
    const [cached] = await this.kv.batchGet([[
      this.manifestPrefix,
      cacheKey,
    ]]);
    if (cached && cached.hash === cacheHash) {
      // console.log("Using KV cached manifest for", plug.name);
      return cached.manifest;
    }
    await plug.sandbox.init();
    const manifest = plug.sandbox.manifest!;
    await this.kv.batchSet([{
      key: [this.manifestPrefix, cacheKey],
      // Deliverately removing the assets from the manifest to preserve space, will be re-added upon load of actual worker
      value: { manifest: { ...manifest, assets: undefined }, hash: cacheHash },
    }]);
    return manifest;
  }
}

export class InMemoryManifestCache<T> implements ManifestCache<T> {
  private cache = new Map<string, {
    manifest: Manifest<T>;
    hash: number;
  }>();

  async getManifest(
    plug: Plug<T>,
    cacheKey: string,
    cacheHash: number,
  ): Promise<Manifest<T>> {
    const cached = this.cache.get(cacheKey);
    if (cached && cached.hash === cacheHash) {
      // console.log("Using memory cached manifest for", plug.name);
      return cached.manifest;
    }
    await plug.sandbox.init();
    const manifest = plug.sandbox.manifest!;

    // Deliverately removing the assets from the manifest to preserve space, will be re-added upon load of actual worker
    this.cache.set(cacheKey, {
      manifest: { ...manifest, assets: undefined },
      hash: cacheHash,
    });
    return manifest;
  }
}
