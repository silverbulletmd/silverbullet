document.getElementById("root").addEventListener("click", (e) => {
  // console.log("Got click", e.target)
  const dataSet = e.target.dataset;
  if (dataSet["onclick"]) {
    syscall("event.dispatch", "preview:click", dataSet["onclick"]).catch((e) =>
      console.log("Error", e)
    );
  } else if (dataSet["pos"]) {
    syscall(
      "event.dispatch",
      "preview:click",
      JSON.stringify(["pos", dataSet["pos"]]),
    ).catch((e) => console.log("Error", e));
  }
});
