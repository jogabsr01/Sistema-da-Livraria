import health from '../../netlify/functions/health.mjs';

export default async function handler(req, res) {
  const response = await health(new Request('https://localhost/api/v1/health', { method: req.method }));
  for (const [name, value] of response.headers) res.setHeader(name, value);
  res.status(response.status).send(Buffer.from(await response.arrayBuffer()));
}
