# 离线识别运行时分发说明

本目录随应用分发，只收录已经放进应用的许可正文。识别运行时是 Pyodide 314.0.7，随包组件是 NumPy 2.4.6、opencv-python 4.11.0.86 和 Pillow 12.2.0。这里没有 Pyodide 的 `package.json` 副本，也没有三个 wheel 的 `METADATA` 副本；版本和许可字段记录在 `wheel-license-manifest.json`。

## 版本与来源

- Pyodide 314.0.7，MPL-2.0。正文是 `pyodide/LICENSE`。[版本化源码 LICENSE](https://raw.githubusercontent.com/pyodide/pyodide/314.0.7/LICENSE)。官方版本声明见 [CDN package.json](https://cdn.jsdelivr.net/pyodide/v314.0.7/full/package.json)。
- CPython 3.14.2，PSF License 2。正文是 `runtime-upstream/cpython-3.14.2-LICENSE`。[官方 LICENSE](https://raw.githubusercontent.com/python/cpython/v3.14.2/LICENSE)。
- Emscripten 5.0.3，MIT 与 University of Illinois/NCSA，并带有其 musl 版权说明。正文是 `runtime-upstream/emscripten-5.0.3-LICENSE` 与 `runtime-upstream/emscripten-5.0.3-musl-COPYRIGHT`。[官方 LICENSE](https://raw.githubusercontent.com/emscripten-core/emscripten/5.0.3/LICENSE)，[musl COPYRIGHT](https://raw.githubusercontent.com/emscripten-core/emscripten/5.0.3/system/lib/libc/musl/COPYRIGHT)。
- NumPy 2.4.6，许可表达为 BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0。正文在 `wheels/numpy/`。[官方 LICENSE](https://github.com/numpy/numpy/blob/v2.4.6/LICENSE.txt)，[官方 wheel](https://cdn.jsdelivr.net/pyodide/v314.0.7/full/numpy-2.4.6-cp314-cp314-pyemscripten_2026_0_wasm32.whl)。
- opencv-python 4.11.0.86。`wheels/opencv-python/` 同时保留包装层 `LICENSE.txt` 和 OpenCV 第三方通知 `LICENSE-3RD-PARTY.txt`。[官方仓库](https://github.com/opencv/opencv-python)，[官方 wheel](https://cdn.jsdelivr.net/pyodide/v314.0.7/full/opencv_python-4.11.0.86-cp314-cp314-pyemscripten_2026_0_wasm32.whl)。
- Pillow 12.2.0，MIT-CMU。正文是 `wheels/Pillow/pillow-12.2.0.dist-info/licenses/LICENSE`。[官方 LICENSE](https://github.com/python-pillow/Pillow/blob/12.2.0/LICENSE)，[官方 wheel](https://cdn.jsdelivr.net/pyodide/v314.0.7/full/pillow-12.2.0-cp314-cp314-pyemscripten_2026_0_wasm32.whl)。

Pyodide 的 ABI 说明记录了上述 CPython 与 Emscripten 版本：[pyemscripten_2026_0](https://pyodide.org/en/stable/development/abi/314.html)。

## 字形字体

识别字形由本机字体栅格化生成。应用不附带这些字体文件。完整字体许可通知在同目录 `font-notices.txt`：

- Liberation Fonts，SIL Open Font License 1.1，https://github.com/liberationfonts
- DejaVu fonts，Bitstream Vera 许可，DejaVu 的改动为公共领域，https://dejavu-fonts.github.io/
- Noto Sans Mono，SIL Open Font License 1.1，https://github.com/googlei18n/noto-fonts
- Ubuntu Font Family，Ubuntu Font Licence 1.0，https://design.ubuntu.com/font/

本说明不是法律意见，也不是对 wasm 二进制全部传递依赖的许可证审计。
