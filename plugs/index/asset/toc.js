function processClick(e) {
  const dataEl = e.target.closest("[data-ref]");
  syscall(
    "system.invokeFunction",
    "index.navigateToMention",
    dataEl.getAttribute("data-ref"),
  ).catch(console.error);
}

document.getElementById("link-ul").addEventListener("click", processClick);
document.getElementById("hide-button").addEventListener("click", () => {
  syscall("system.invokeFunction", "index.toggleTOC").catch(console.error);
});

document.body.addEventListener("mouseenter", () => {
  console.log("Refreshing on focus");
  syscall("system.invokeFunction", "index.renderTOC").catch(
    console.error,
  );
});

document.getElementById("reload-button").addEventListener("click", () => {
  syscall("system.invokeFunction", "index.renderTOC").catch(
    console.error,
  );
});
