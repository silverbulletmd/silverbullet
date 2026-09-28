import { expect, openLivePage, test } from "../fixtures/offline.ts";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

test.use({ spaceFiles: { "index.md": "Share target space" } });

test("a shared text opens an editable capture draft", async ({
  page,
  sbServer,
}) => {
  await openLivePage(page, sbServer.url, "Share target space");
  await page.evaluate(() => {
    const form = document.createElement("form");
    form.method = "POST";
    form.enctype = "multipart/form-data";
    form.action = "/.client/share-target";
    const text = document.createElement("input");
    text.name = "text";
    text.value = "Shared from another app";
    form.append(text);
    document.body.append(form);
    form.submit();
  });
  await expect(
    page.getByRole("dialog", { name: "Capture share" }),
  ).toBeVisible();
  await expect(page.getByLabel("Text")).toHaveValue("Shared from another app");
  await expect(
    page.getByRole("button", { name: /Save as Quick Note/ }),
  ).toBeVisible();
});

test("saving a shared file creates an Inbox note with a working file link", async ({
  page,
  sbServer,
}) => {
  await openLivePage(page, sbServer.url, "Share target space");
  await page.evaluate(() => {
    const form = document.createElement("form");
    form.method = "POST";
    form.enctype = "multipart/form-data";
    form.action = "/.client/share-target";
    const text = document.createElement("input");
    text.name = "text";
    text.value = "Shared file note";
    const files = document.createElement("input");
    files.type = "file";
    files.name = "files";
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([Uint8Array.from([0, 1, 255])], "sample.bin", {
        type: "application/octet-stream",
      }),
    );
    files.files = transfer.files;
    form.append(text, files);
    document.body.append(form);
    form.submit();
  });
  await expect(
    page.getByRole("dialog", { name: "Capture share" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Save as Quick Note/ }).click();
  const inbox = join(sbServer.spaceDir, "Inbox");
  await expect
    .poll(
      async () =>
        (await readdir(inbox, { recursive: true }).catch(() => [])).filter(
          (path) => path.endsWith(".md"),
        ).length,
    )
    .toBe(1);
  const paths = await readdir(inbox, { recursive: true });
  const note = paths.find((path) => path.endsWith(".md"))!;
  const content = await readFile(join(inbox, note), "utf8");
  expect(content).toContain("Shared file note");
  expect(content).toContain("sample.bin");
  const documentPath = paths.find((path) => path.endsWith("sample.bin"))!;
  expect([...(await readFile(join(inbox, documentPath)))]).toEqual([0, 1, 255]);
});

test("two incoming shares stay queued independently", async ({
  page,
  sbServer,
}) => {
  await openLivePage(page, sbServer.url, "Share target space");
  for (const text of ["First shared item", "Second shared item"]) {
    await page.evaluate((value) => {
      const form = document.createElement("form");
      form.method = "POST";
      form.enctype = "multipart/form-data";
      form.action = "/.client/share-target";
      const field = document.createElement("input");
      field.name = "text";
      field.value = value;
      form.append(field);
      document.body.append(form);
      form.submit();
    }, text);
    await expect(page.getByLabel("Text")).toHaveValue(text);
  }
  await expect(page.getByText("2 pending captures")).toBeVisible();
  await page.getByLabel("Text").fill("Edited second item");
  await page.getByRole("button", { name: "Next capture" }).click();
  await expect(page.getByLabel("Text")).toHaveValue("First shared item");
  await page.getByRole("button", { name: "Next capture" }).click();
  await expect(page.getByLabel("Text")).toHaveValue("Edited second item");
});

test("a previously opened space receives a share while offline", async ({
  page,
  sbServer,
}) => {
  await openLivePage(page, sbServer.url, "Share target space");
  await sbServer.stop();
  await page.evaluate(() => {
    const form = document.createElement("form");
    form.method = "POST";
    form.enctype = "multipart/form-data";
    form.action = "/.client/share-target";
    const text = document.createElement("input");
    text.name = "text";
    text.value = "Offline shared item";
    form.append(text);
    document.body.append(form);
    form.submit();
  });
  await expect(page.getByLabel("Text")).toHaveValue("Offline shared item");
});

test.describe("programmable actions", () => {
  test.use({
    spaceFiles: {
      "index.md": "Share target space",
      "Capture Actions.md": [
        "```space-lua",
        "service.define {",
        '  selector = "capture",',
        "  match = function(data)",
        '    if data.text == "Please route this" then return { name = "Route request", description = "Custom capture" } end',
        "  end,",
        '  run = function(data) error("Synthetic action failure") end',
        "}",
        "service.define {",
        '  selector = "capture",',
        "  match = function(data)",
        '    if #data.files > 0 then return { name = "Save custom file" } end',
        "  end,",
        '  run = function(data) capture.saveFile(data.files[1].handle, "Inbox/custom-" .. data.id .. ".bin") end',
        "}",
        "```",
      ].join("\n"),
    },
  });

  test("a failing matching action keeps the draft available", async ({
    page,
    sbServer,
  }) => {
    await openLivePage(page, sbServer.url, "Share target space");
    await page.evaluate(() => {
      const form = document.createElement("form");
      form.method = "POST";
      form.enctype = "multipart/form-data";
      form.action = "/.client/share-target";
      const text = document.createElement("input");
      text.name = "text";
      text.value = "Please route this";
      form.append(text);
      document.body.append(form);
      form.submit();
    });
    await expect(
      page.getByRole("button", { name: /Route request/ }),
    ).toBeVisible();
    await page.getByRole("button", { name: /Route request/ }).click();
    await expect(page.getByRole("alert")).toContainText(
      "Synthetic action failure",
    );
    await expect(page.getByLabel("Text")).toHaveValue("Please route this");
  });

  test("a custom action saves exact shared file bytes", async ({
    page,
    sbServer,
  }) => {
    await openLivePage(page, sbServer.url, "Share target space");
    await page.evaluate(() => {
      const form = document.createElement("form");
      form.method = "POST";
      form.enctype = "multipart/form-data";
      form.action = "/.client/share-target";
      const files = document.createElement("input");
      files.type = "file";
      files.name = "files";
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([Uint8Array.from([0, 1, 255])], "custom.bin"),
      );
      files.files = transfer.files;
      form.append(files);
      document.body.append(form);
      form.submit();
    });
    await page.getByRole("button", { name: "Save custom file" }).click();
    await expect(
      page.getByRole("dialog", { name: "Capture share" }),
    ).toHaveCount(0);
    const files = await readdir(join(sbServer.spaceDir, "Inbox"));
    const saved = files.find(
      (file) => file.startsWith("custom-") && file.endsWith(".bin"),
    );
    expect(saved).toBeDefined();
    expect([
      ...(await readFile(join(sbServer.spaceDir, "Inbox", saved!))),
    ]).toEqual([0, 1, 255]);
  });
});
