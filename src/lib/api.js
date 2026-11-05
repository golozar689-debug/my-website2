export async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) throw new Error('ارتباط با سرور برقرار نشد. لطفاً دوباره تلاش کنید.');
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'انجام درخواست ممکن نشد. دوباره تلاش کنید.');
  return data;
}
