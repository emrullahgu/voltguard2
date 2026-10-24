/* Harmonic RMS model: orthogonal integer harmonics, ideal equal attenuation. */
(function (root) {
  'use strict';
  function calculate(harmonics, attenuation) {
    if (!Array.isArray(harmonics) || harmonics.length !== 3 ||
        harmonics.some(function (value) { return !Number.isFinite(value) || value < 0 || value > 50; }) ||
        !Number.isFinite(attenuation) || attenuation < 0 || attenuation > 100) {
      throw new RangeError('Harmonikler %0–50, bastırma %0–100 aralığında olmalı.');
    }
    var thd = Math.hypot.apply(Math, harmonics);
    var outputThd = thd * (1 - attenuation / 100);
    return { inputThd: thd, outputThd: outputThd,
      inputRms: 230 * Math.hypot(1, thd / 100), outputRms: 230 * Math.hypot(1, outputThd / 100) };
  }
  var api = { calculate: calculate };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VGPowerQuality = api;
}(typeof window === 'undefined' ? globalThis : window));
