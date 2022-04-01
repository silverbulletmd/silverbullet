import mdParser from "../../webapp/parser";
import { getText } from "plugos-silverbullet-syscall/editor";

export async function renderMD() {
  let text = await getText();
  let tree = mdParser.parser.parse(text);
  let slicesToRemove: [number, number][] = [];

  tree.iterate({
    enter(type, from, to): false | void {
      switch (type.name) {
        case "Comment":
          slicesToRemove.push([from, to]);
          return false;
      }
    },
  });
  // console.log("output peices", JSON.stringify(tree));
  slicesToRemove.reverse().forEach(([from, to]) => {
    text = text.slice(0, from) + text.slice(to);
  });
  console.log("Clean md", text);
}
