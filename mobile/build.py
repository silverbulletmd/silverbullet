import json

html = open("dist/index.html", "r").read()
f = open("bundle.json", "w")
f.write(json.dumps({"html": html}))
f.close()