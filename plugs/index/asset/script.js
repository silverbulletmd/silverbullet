function processClick(e) {
  const dataEl = e.target.closest("[data-ref]");
  sendEvent("mentions:navigate", dataEl.getAttribute("data-ref"));
}

document.getElementById("link-ul").addEventListener("click", processClick);
document.getElementById("hide-button").addEventListener("click", function () {
  sendEvent("mentions:hide");
});
updateHeight();
