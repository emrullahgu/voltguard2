const loopback = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
export function employeeSourceStatus(source, hostname = '', sahaSource) {
  const sahaMissing = sahaSource?.required === true && sahaSource.configured === false;
  if (source === 'ubuntu' && !sahaMissing) return { available: true, development: false, label: 'Kayıtlar: şirket sunucusu', message: '' };
  if (source === 'local' && loopback.has(String(hostname).toLowerCase())) return {
    available: true, development: true, label: 'Yerel geliştirme verileri',
    message: 'Bu ortam canlı şirket kayıtlarını kullanmıyor.',
  };
  return {
    available: false, development: false, label: 'Şirket sunucusu bağlantısı doğrulanamadı',
    message: 'Mevcut kayıtlarınız için Ubuntu şirket sunucusu bağlantısı gerekiyor. Bağlantı kurulmadan boş listeler şirket kayıtlarını temsil etmez.',
  };
}
