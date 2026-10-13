// Populated from the authorized company bootstrap before importing business modules.
// No invoice, catalogue price or third-party credential is embedded in the build.
export let historicalInvoice1 = [];
export let historicalInvoice2 = [];
export let cablePrices = {kategoriler:[]};
export let packages = {paketler:[]};
export function setCatalog(catalog = {}) {
  historicalInvoice1 = Array.isArray(catalog.historicalInvoice1) ? catalog.historicalInvoice1 : [];
  historicalInvoice2 = Array.isArray(catalog.historicalInvoice2) ? catalog.historicalInvoice2 : [];
  const cable = catalog.cablePrices && typeof catalog.cablePrices === 'object' && !Array.isArray(catalog.cablePrices) ? catalog.cablePrices : {};
  cablePrices = {...cable, kategoriler:Array.isArray(cable.kategoriler) ? cable.kategoriler : []};
  const ready = catalog.packages && typeof catalog.packages === 'object' && !Array.isArray(catalog.packages) ? catalog.packages : {};
  packages = {...ready, paketler:Array.isArray(ready.paketler) ? ready.paketler : []};
}
