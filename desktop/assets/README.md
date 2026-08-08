# 桌面端品牌素材

- `../../public/assets/codepilot-mark.png` 是 Renderer 与 Favicon 使用的透明背景主视觉素材。
- `codepilot.ico` 是 Windows / Electron 派生图标，包含 16、24、32、48、64、128 和 256 px 尺寸。
- 桌面端派生图标使用更紧凑的 10% Optical Safe Area，确保图形在 Windows Taskbar 中仍可辨识。
- 更新时先修改主 PNG，再运行 `python desktop/assets/build_icon.py`；不要独立编辑两个素材。
