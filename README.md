# 空窓 soramado

**ディスプレイを「空への窓」に。/ Turn your display into a window to an endless sky.**

PC・スマートフォン・タブレットの画面全体に、どこまでも広がる空を表示するWebアプリです。画像やグラデーション画像は一切使わず、レイリー散乱・ミー散乱にもとづく大気散乱シミュレーションをWebGL2でリアルタイムにレンダリングします。朝焼けから昼の青空、夕焼け、薄明、星空まで、すべての色は物理計算から導出されます。

soramado is a web app that fills your entire screen with a boundless sky. It uses no images or gradient textures — everything is rendered in real time with a physically based atmospheric-scattering simulation (Rayleigh + Mie single scattering) on WebGL2. Dawn, daylight, sunset, twilight and the starry night all emerge from the same radiative-transfer computation; no colours are hard-coded.

> 本プロジェクトは独立したオープンソースプロジェクトであり、特定の商用製品とは無関係です(This is an independent open-source project, unaffiliated with any commercial product)。レイリー散乱・ミー散乱といった大気光学は公知の自然科学であり、本実装は公開研究(Bruneton & Neyret 2008 ほか)にもとづくオリジナルのコードです。

---

## 特徴 / Features

- **物理ベースの空** — レイリー散乱(波長依存 λ⁻⁴)+ミー散乱の単一散乱モデルをフラグメントシェーダでレイマーチング計算。オゾン吸収も含み、薄明の藍色まで物理的に再現 / Physically based sky: single-scattering Rayleigh (λ⁻⁴) + Mie ray marching in a fragment shader, with ozone absorption for the deep indigo of twilight
- **「発光点を特定させない」設計** — 太陽ディスクはデフォルト非表示。HDR → ACESトーンマップ → ガンマ補正 → **ブルーノイズディザリング**(8bit出力でのバンディング防止)。視線にごく微小な漂動を入れて静止画感を排除 / Designed to hide the light source: no sun disc by default, HDR → ACES tone mapping → gamma → **blue-noise dithering** (kills 8-bit banding), plus an imperceptibly slow view drift so the image never reads as a still picture
- **時刻システム** — 実時刻+位置情報(拒否時は手入力または東京)/ 手動スライダー / デモモード(1日を2分で再生)。太陽位置はNOAAの太陽位置算法 / Time modes: real time + geolocation (manual/Tokyo fallback), manual slider, and a demo mode (a full day in 2 minutes). Solar position via the NOAA solar calculator equations
- **夜空** — 実在の恒星カタログ116星(本物の星座が正しい位置に)+手続き生成の微光星+天の川(銀河座標で実位置)+大気光。星は恒星時で回転し、地平線近くほど強く瞬き、大気減光で赤くなる / Real 116-star catalogue (true constellations), procedural faint stars, the Milky Way at its true galactic position, airglow; stars rotate with sidereal time, twinkle harder near the horizon and redden with extinction
- **月** — Meeus略算暦(視差補正つき、誤差≈0.3°)による正確な位置・満ち欠け(明暗境界・地球照)・月光によるレイリー散乱の青い夜空 / The moon: truncated-Meeus ephemeris (~0.3° with topocentric parallax), correct phase terminator & earthshine, and a genuinely moonlit Rayleigh-blue night sky
- **オーロラ** — 地磁気緯度で自動ゲートされるカーテン(緑557.7nm/赤630nm/紫の縁、揺らぎ・拡散・シマーの3時間スケール)/ Aurora gated by geomagnetic latitude: green/red/purple emission profile, waving folds, diffuse glow and shimmering striations
- **旅する空** — 都市プリセット(南半球・白夜/極夜・オーロラ帯を含む33都市)でその土地の「いま」の空と現地時刻を表示。季節も白夜も物理から自動再現 / "Remote skies": 33 city presets (southern hemisphere, polar day/night, auroral zone) showing that place's sky right now with its local clock — seasons and the midnight sun follow from the physics
- **オプション** — 太陽ディスク表示、多層の雲(巻雲+中層雲、実高度・実風速・移流・なびき)、地平線の霞、端末の傾き視差 / Optional sun disc, layered clouds (real altitudes/winds, advection, wind-combed fibres), horizon haze, device-tilt parallax
- **PWA** — インストール・オフライン動作・Wake Lock(スリープ防止)・iOSセーフエリア/100dvh対応 / Installable PWA, offline capable, Wake Lock, iOS safe-area & 100dvh handling
- **自動品質調整** — レイマーチングのサンプル数と描画解像度をフレームレートに応じて自動調整(60fps目標)/ Adaptive quality: sample count & resolution scale to hold 60 fps, including on phones

## 使い方 / Usage

```bash
cd web
npm install
npm run dev      # 開発サーバ / dev server
npm run build    # 本番ビルド (dist/) / production build
npm run preview  # ビルドの確認 / preview the build
```

起動するとデバイスのタイムゾーンから場所を推定し(許可ダイアログなし)、その土地の「いま」の空が実時間で移ろいます。画面をタップまたはマウスを動かすと、時計チップと小さなガラス調ボタン(フルスクリーン・設定)が3秒だけ現れます。歯車から開く設定パネルで、時刻モード(実時刻/手動/デモ)、場所(現在地ボタンでGPS精密測位・緯度経度手入力)、太陽ディスク/巻雲/星のトグル、視点(仰角・方位)、明るさ、画質、Wake Lockを変更できます。UIは昼は明るいガラス+濃色の文字、夜は深色ガラス+白文字に自動で切り替わります。設定はlocalStorageに保存されます。

On launch the app estimates your location from the device timezone (no permission prompt) and shows that place's sky in real time. Tapping or moving the mouse reveals a small clock chip and two glass buttons (fullscreen / settings) for 3 seconds; the gear opens a panel with time mode, location (precise GPS optional), sun-disc / cirrus / stars toggles, view direction, brightness, quality and Wake Lock. The glass UI adapts between day and night. Settings persist in localStorage.

iPhone / iPad では共有メニューの「ホーム画面に追加」でフルスクリーンのPWAとして起動できます。 On iPhone/iPad, use "Add to Home Screen" for a fullscreen PWA.

## Cloudflare Pages へのデプロイ / Deploying to Cloudflare Pages

1. このリポジトリをGitHubに置き、Cloudflare Pagesで **Create a project → Connect to Git** から接続 / Push this repo to GitHub and connect it in Cloudflare Pages
2. ビルド設定 / Build configuration:
   - **Root directory**: `web`
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`(リポジトリルートから見ると `web/dist` / `web/dist` when viewed from the repo root)
3. デプロイ後、`/lut/` 配下にLUTを置く場合は `web/public/lut/` にコミットしてから再デプロイします / To enable the precomputed-LUT mode, commit the LUT files under `web/public/lut/` and redeploy

## レンダリングの仕組み / How the rendering works

1. **単一散乱モデル** — 視線レイに沿って光学的深度をレイマーチング(自動品質で20〜64サンプル、太陽方向へさらに4〜10サンプル)し、レイリー散乱(βはλ⁻⁴則から導出)・ミー散乱(Henyey-Greenstein位相関数、g=0.8)・オゾン吸収を積分します。地球半径6360km、大気スケールハイト(レイリー8.5km / ミー1.2km)は実値です。 / The view ray is ray-marched (20–64 samples, plus 4–10 toward the sun) integrating Rayleigh scattering (β derived from the λ⁻⁴ law), Mie scattering (Henyey–Greenstein phase, g=0.8) and ozone absorption, with real Earth/atmosphere dimensions.
2. **トーンマッピング** — HDR放射輝度をACES近似でトーンマップし、ガンマ補正後に**ブルーノイズディザ**(void-and-cluster法で起動時に生成、64×64、時間方向にもシフト)を加えて8bit量子化のバンディングを抑えます。 / HDR radiance → ACES tone map → gamma → blue-noise dither (a real void-and-cluster mask generated at first launch, temporally shifted) to suppress banding.
3. **露出** — 太陽高度に応じて露出を連続変化させ、目の暗順応を再現します(色はあくまで散乱計算の結果)。 / Exposure follows solar elevation to emulate dark adaptation; colours always come from the scattering integral.
4. **夜** — 星はハッシュベースの手続き生成で、緯度と恒星時から組み立てた回転行列により実際の日周運動で回ります。大気光(van Rhijn効果つき)をブレンドします。 / Stars are hash-procedural, rotated by a matrix built from latitude and local sidereal time; airglow with van-Rhijn horizon brightening is blended in.

## /colab — 多重散乱LUTの事前計算 / Precomputed multiple scattering

GPUでの重い事前計算はすべてGoogle Colabで行う方針です。`colab/multi_scattering_lut.ipynb` は、多重散乱を含む透過率LUT・散乱LUTを計算して `manifest.json` + `transmittance.bin` + `scattering.bin`(float32)としてエクスポートするノートブックです。

All heavy GPU precomputation happens in Google Colab. `colab/multi_scattering_lut.ipynb` computes transmittance and multiple-scattering LUTs and exports them as `manifest.json` + `transmittance.bin` + `scattering.bin` (float32).

1. ノートブックをColabで開き、GPUランタイム(T4で可)を選択して全セルを実行 / Open the notebook in Colab, choose a GPU runtime, run all cells
2. 生成された `soramado_lut.zip` を展開し、中身を `web/public/lut/` に配置 / Unzip the produced `soramado_lut.zip` into `web/public/lut/`
3. アプリは起動時に `/lut/manifest.json` を確認し、**あれば多重散乱LUTモード、なければ単一散乱のリアルタイム計算に自動フォールバック**します / On startup the app probes `/lut/manifest.json` and uses the LUT path when present, otherwise falls back to realtime single scattering

LUTの読み込みは `web/src/atmosphere/lut.ts` の `SkySource` インターフェースに抽象化されており、将来のニューラル空モデル(Colabで学習→テクスチャ/ONNX化)も同じ差し替え口から導入できます。 / LUT loading is abstracted behind the `SkySource` interface in `web/src/atmosphere/lut.ts`; a future neural sky model (trained in Colab) can plug into the same seam.

## リポジトリ構成 / Repository layout

```
web/    アプリ本体 (Vite + TypeScript + WebGL2, PWA)
colab/  GPU事前計算用ノートブック / GPU precomputation notebooks
```

## 品質目標 / Quality goals

- iPhoneを含み60fps(サンプル数・解像度の自動調整) / 60 fps including phones (adaptive sampling & resolution)
- 地平線付近は白く霞み、天頂は深い青。夕方は赤→マゼンタ→藍へ物理的に正しく遷移 / Horizon haze, deep zenith blue, and the physically correct red → magenta → indigo sunset progression
- バンディングが肉眼で見えないこと(ブルーノイズディザは必須要件) / No visible banding (blue-noise dithering is a hard requirement)

## 参考文献 / References

- E. Bruneton & F. Neyret, *Precomputed Atmospheric Scattering*, EGSR 2008
- S. Hillaire, *A Scalable and Production Ready Sky and Atmosphere Rendering Technique*, EGSR 2020
- NOAA ESRL Solar Calculator equations(太陽位置算法)
- R. Ulichney, *The void-and-cluster method for dither array generation*, 1993

## ライセンス / License

MIT — see [LICENSE](LICENSE).
