Precomputed multiple-scattering LUTs go here (optional).

Generate them with /colab/multi_scattering_lut.ipynb and place:
  manifest.json
  transmittance.bin
  scattering.bin

If manifest.json is absent the app automatically falls back to the
realtime single-scattering renderer. See /colab/README.md for the
binary layout and the LUT parameterisation.
