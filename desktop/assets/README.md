# Desktop brand assets

- `../../public/assets/codepilot-mark.png` is the canonical transparent visual asset used by the renderer and favicon.
- `codepilot.ico` is the Windows/Electron derivative containing 16, 24, 32, 48, 64, 128 and 256 px entries.
- The desktop derivative uses a tighter 10% optical safe area so the mark remains legible in the Windows taskbar.
- Update the canonical PNG first, then run `python desktop/assets/build_icon.py`; do not edit the two assets independently.
