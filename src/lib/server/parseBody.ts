/** Parse JSON or form-urlencoded / multipart bodies into a plain object. */
export async function parseRequestBody(
  request: Request,
): Promise<Record<string, unknown>> {
  const type = request.headers.get('content-type') ?? '';
  if (type.includes('application/json')) {
    const raw = await request.json();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('Invalid JSON object');
    }
    return raw as Record<string, unknown>;
  }

  const form = await request.formData();
  const out: Record<string, unknown> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value !== 'string') continue;
    if (key === 'subjects') {
      out[key] = value === '' ? undefined : Number(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}
