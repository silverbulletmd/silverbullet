import axios from "axios";
import fs from "node:fs";

export async function downloadFile(
  url: string,
  destFile: string,
): Promise<void> {
  const file = fs.createWriteStream(destFile);
  let response = await axios.request({
    url: url,
    method: "GET",
    responseType: "stream",
  });
  return new Promise((resolve, reject) => {
    response.data.pipe(file);
    let error: Error | null = null;
    file.on("error", (e) => {
      error = e;
      reject(e);
    });
    file.on("close", () => {
      if (error) {
        return;
      }
      file.close();
      resolve();
    });
  });
}
