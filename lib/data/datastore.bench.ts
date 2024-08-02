import { DataStore } from "$lib/data/datastore.ts";
import { MemoryKvPrimitives } from "$lib/data/memory_kv_primitives.ts";

Deno.bench("DataStore enrichment benchmark with match", (b) => {
  // Dummy datastore with a single object enricher
  const datastore = new DataStore(new MemoryKvPrimitives(), {});

  datastore.objectDecorators = [
    {
      where: ["=", ["attr", "tags"], ["string", "person"]],
      attributes: {
        fullName: ["+", ["+", ["attr", "firstName"], ["string", " "]], [
          "attr",
          "lastName",
        ]],
      },
    },
  ];

  b.start();
  // Let's try with half a million entries
  for (let i = 0; i < 500000; i++) {
    const obj = {
      firstName: "Pete",
      lastName: "Smith",
      tags: ["person"],
    };
    datastore.enrichObject(obj);
  }
  b.end();
});

Deno.bench("DataStore enrichment benchmark without match", (b) => {
  // Dummy datastore with a single object enricher
  const datastore = new DataStore(new MemoryKvPrimitives(), {});

  datastore.objectDecorators = [
    {
      where: ["=", ["attr", "tags"], ["string", "person"]],
      attributes: {
        fullName: ["+", ["+", ["attr", "firstName"], ["string", " "]], [
          "attr",
          "lastName",
        ]],
      },
    },
  ];

  b.start();
  // Let's try with half a million entries
  for (let i = 0; i < 500000; i++) {
    const obj = {
      firstName: "Pete",
      lastName: "Smith",
      tags: ["peson"],
    };
    datastore.enrichObject(obj);
  }
  b.end();
});
