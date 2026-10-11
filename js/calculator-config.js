window.VoltGuardCalculatorConfig = {
  version: '2026-10-11',
  pricing: {
    gesInvestmentLowPerKwp: 22000,
    gesInvestmentHighPerKwp: 32000,
    defaultElectricityUnitPrice: 3.5,
    panelWatt: 550,
    inverterAcRatio: 0.8,
    performanceRatio: 0.95,
    areaPerKwpRoof: 5.5,
    areaPerKwpLand: 8
  },
  technical: {
    copperResistivity: 0.0175,
    voltageDropLimitLightingPct: 3,
    voltageDropLimitPowerPct: 5,
    inverterAcDropLimitPct: 1.5,
    inverterDcDropLimitPct: 1,
    threePhaseMinVoltage: 300,
    cableCosPhi: 0.9,
    cableCurrentMargin: 1.25,
    inverterEfficiency: 0.99,
    projectRatePerM2: 55,
    powerIncreaseUnitCostPerKva: 3200,
    factoryGrowthFactor: 1.2,
    fireDetectorAreaM2: 60,
    lightingUtilizationFactor: 0.6,
    upsMarginRatio: 0.2,
    contactorMotorCosPhi: 0.86,
    mpcbMinRatio: 0.8,
    mpcbMaxRatio: 1.25,
    sections: [1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240],
    // Iz (A): bakır, PVC, 30 °C, kanal/boru içi (Yöntem B1); bilgi/kablo-kesiti-akim-tasima-tablosu.html ve bağımsız hesap sayfalarıyla aynı değerler.
    ampacityB1ThreeLoaded: [15.5, 21, 28, 36, 50, 68, 89, 110, 134, 171, 207, 239, 262, 296, 346],
    ampacityB1TwoLoaded: [18, 24, 32, 41, 57, 76, 101, 125, 151, 192, 232, 269, 309, 353, 415],
    transformerKva: [250, 400, 630, 800, 1000, 1250, 1600, 2000],
    generatorKva: [65, 90, 110, 150, 165, 200, 220, 275, 330, 385, 440, 500, 550, 605, 660, 715, 825, 900, 1000, 1100, 1250, 1400, 1600, 1800, 2000],
    upsKva: [1, 3, 6, 10, 15, 20, 30, 40, 60, 80, 100, 120, 160, 200, 250, 300, 400, 500, 600, 800],
    breakerAmps: [6, 10, 13, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000],
    contactorAmps: [9, 12, 18, 25, 32, 40, 50, 65, 80, 95, 115, 150, 185, 225, 265, 330, 400, 500, 630]
  },
  notes: {
    source: 'Ön değerlendirme varsayımları',
    disclaimer: 'Bu katsayılar bağlayıcı fiyat teklifi değildir. Lisanslı EMO/TEDAŞ verileri, keşif ve güncel tedarik maliyetleriyle doğrulanmalıdır.'
  }
};
