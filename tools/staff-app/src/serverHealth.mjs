// Verify the company API contract: a proxy's generic HTTP 200 page is not a healthy backend.
export async function checkCompanyHealth({ signal, fetcher = globalThis.fetch } = {}) {
  try {
    const response = await fetcher('/api/company.php?action=health', { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' }, signal });
    const payload = await response.json();
    if (payload?.api !== 'vg-company/1' || typeof payload.ok !== 'boolean') return false;
    if (response.status === 401 || response.status === 403) return false === payload.ok;
    return response.ok && payload.ok && payload.data?.online === true;
  } catch { return false; }
}
