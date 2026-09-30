# Font licenses

All fonts in this folder are bundled with FloatView under the **SIL Open Font License 1.1**.
The OFL allows use, bundling and redistribution inside software (it forbids selling the fonts by themselves).
Each family's full license text is in its folder as `LICENSE.txt`, and it must ship with the app.

Only the **Latin subset, woff2** files for the weights FloatView uses are included (≈ 370 KB total).

| Family | Folder | Weights | Source | License |
|---|---|---|---|---|
| JetBrains Mono | jetbrains-mono | 400, 700 | https://github.com/JetBrains/JetBrainsMono (via @fontsource/jetbrains-mono) | OFL 1.1 |
| Inter | inter | 600, 800 | https://fontsource.org/fonts/inter (npm @fontsource/inter) | OFL 1.1 |
| Space Mono | space-mono | 700 | https://fontsource.org/fonts/space-mono (npm @fontsource/space-mono) | OFL 1.1 |
| Bebas Neue | bebas-neue | 400 | https://fontsource.org/fonts/bebas-neue (npm @fontsource/bebas-neue) | OFL 1.1 |
| Oswald | oswald | 500, 700 | https://fontsource.org/fonts/oswald (npm @fontsource/oswald) | OFL 1.1 |
| Orbitron | orbitron | 700, 900 | https://fontsource.org/fonts/orbitron (npm @fontsource/orbitron) | OFL 1.1 |
| Share Tech Mono | share-tech-mono | 400 | https://fontsource.org/fonts/share-tech-mono (npm @fontsource/share-tech-mono) | OFL 1.1 |
| VT323 | vt323 | 400 | https://fontsource.org/fonts/vt323 (npm @fontsource/vt323) | OFL 1.1 |
| Barlow Condensed | barlow-condensed | 600, 700 | https://fontsource.org/fonts/barlow-condensed (npm @fontsource/barlow-condensed) | OFL 1.1 |
| DSEG7 Classic | dseg7 | 400, 700 | https://github.com/keshikan/DSEG (npm `dseg`) | OFL 1.1 (Reserved Font Name "DSEG") |

Notes
- Oswald, Orbitron and Inter have proportional digits. FloatView sets `font-feature-settings: "tnum"` so fonts that support tabular figures use them, and centers each digit pair in its card so the others don't jump.
- "DSEG" is a Reserved Font Name: the font may not be modified and redistributed under that name. FloatView ships it unmodified.
