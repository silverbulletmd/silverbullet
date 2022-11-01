document.getElementById("root").addEventListener("click", (e) => {
  // console.log("Got click", e.target)
  const dataSet = e.target.dataset;
  if(dataSet["onclick"]) {
    sendEvent("preview:click", dataSet["onclick"]);
  } else if(dataSet["pos"]) {
    sendEvent("preview:click", JSON.stringify(["pos", dataSet["pos"]]));
  }
})