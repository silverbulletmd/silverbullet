# Applicazione della patch upstream

Il fork e il branch verificati sono:

```text
marco10x15/silverbullet
└── configurable-frontmatter-preview
```

Lo script controlla prima i Git blob SHA dei sette file coinvolti. Se `main` o il branch sono cambiati rispetto allo snapshot verificato, si ferma senza sovrascrivere nulla.

## Procedura

```bash
git clone https://github.com/marco10x15/silverbullet.git
cd silverbullet
git checkout configurable-frontmatter-preview
```

Copia `apply_upstream_frontmatter_preview.py` nella directory del repository ed esegui:

```bash
python apply_upstream_frontmatter_preview.py .
```

Lo script modifica soltanto:

```text
client/codemirror/frontmatter_folding.ts
client/codemirror/frontmatter_folding.test.ts
client/codemirror/editor_state.ts
client/styles/editor.scss
libraries/Library/Std/Config.md
docs/Frontmatter.md
docs/CHANGELOG.md
```

Poi:

```bash
git diff --check
git diff
npm ci
make fmt
make check
make test
```

Dopo i test:

```bash
git add client/codemirror/frontmatter_folding.ts         client/codemirror/frontmatter_folding.test.ts         client/codemirror/editor_state.ts         client/styles/editor.scss         libraries/Library/Std/Config.md         docs/Frontmatter.md         docs/CHANGELOG.md

git commit -m "Add configurable folded frontmatter preview"
git push origin configurable-frontmatter-preview
```

## Nota sul connettore GitHub

Il repository è leggibile dalla chat, ma il connettore rifiuta le operazioni di scrittura con `403 Resource not accessible by integration`. Per questo il port viene fornito come script applicabile al clone locale.
