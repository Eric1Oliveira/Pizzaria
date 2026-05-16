// ============================================================
//  GEOCODE.JS — Identificação automática de região de entrega
//  Estratégia: endereço → lat/lon via Nominatim → distância do
//  restaurante → menor zona que cobre a distância (raio_km)
// ============================================================

// Distância em km entre dois pontos (Haversine)
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = x => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Fetch com timeout
async function _geoFetch(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms || 8000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'CasaJoseSilvaApp/1.0', 'Accept-Language': 'pt-BR' }
    });
    return res.ok ? res : null;
  } catch (_) { return null; }
  finally { clearTimeout(t); }
}

// Consulta Nominatim e retorna { lat, lon } ou null
async function _nominatim(params) {
  const qs = new URLSearchParams({ format: 'json', limit: '1', ...params }).toString();
  const res = await _geoFetch(`https://nominatim.openstreetmap.org/search?${qs}`);
  if (!res) return null;
  try {
    const data = await res.json();
    if (Array.isArray(data) && data.length) return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
  } catch (_) {}
  return null;
}

const _sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Geocodifica um endereço com 4 estratégias de fallback.
 * Retorna { lat, lon } ou null.
 */
async function geocodeWithFallback({ cep, street, number, bairro, cidade, uf }) {
  const cleanCep = (cep || '').replace(/\D/g, '');

  // 1) CEP direto — mais preciso no Brasil
  if (cleanCep.length === 8) {
    const r = await _nominatim({ postalcode: cleanCep, country: 'BR' });
    if (r) { console.log('[Geo] Encontrado via CEP:', r); return r; }
    await _sleep(300);
  }

  // 2) Rua + número + bairro + cidade + UF
  if (street && cidade) {
    const q = [street, number, bairro, cidade, uf, 'Brasil'].filter(Boolean).join(', ');
    const r = await _nominatim({ q });
    if (r) { console.log('[Geo] Encontrado via endereço completo:', r); return r; }
    await _sleep(300);
  }

  // 3) Bairro + cidade + UF
  if (bairro && cidade) {
    const q = [bairro, cidade, uf, 'Brasil'].filter(Boolean).join(', ');
    const r = await _nominatim({ q });
    if (r) { console.log('[Geo] Encontrado via bairro+cidade:', r); return r; }
    await _sleep(300);
  }

  // 4) Cidade + UF (fallback amplo — retorna centro da cidade, útil para definir zona)
  if (cidade) {
    const q = [cidade, uf, 'Brasil'].filter(Boolean).join(', ');
    const r = await _nominatim({ q });
    if (r) { console.log('[Geo] Encontrado via cidade:', r); return r; }
  }

  console.warn('[Geo] Não foi possível geocodificar o endereço.');
  return null;
}

/**
 * Dada lat/lon do cliente, retorna a menor zona de entrega que cobre o endereço.
 * @param {number} lat
 * @param {number} lon
 * @param {Array}  zones   — array de delivery_zones ordenado por raio_km ASC
 * @param {number} restaurantLat
 * @param {number} restaurantLng
 * @returns {Object|null} zone ou null se fora de área
 */
function getZoneByDistance(lat, lon, zones, restaurantLat, restaurantLng) {
  if (!Array.isArray(zones) || !zones.length) return null;
  const dist = haversineKm(lat, lon, restaurantLat, restaurantLng);
  console.log(`[Entrega] Distância do restaurante: ${dist.toFixed(3)} km | Zonas: ${zones.map(z => z.raio_km + 'km').join(', ')}`);
  for (const zone of zones) {
    if (dist <= parseFloat(zone.raio_km)) {
      console.log(`[Entrega] Zona: "${zone.nome}" (raio ${zone.raio_km} km) | Taxa: R$${zone.taxa_entrega}`);
      return zone;
    }
  }
  console.warn(`[Entrega] Fora de área (dist: ${dist.toFixed(3)} km)`);
  return null;
}

// API pública
window.CJSGeo = { geocodeWithFallback, getZoneByDistance, haversineKm };
