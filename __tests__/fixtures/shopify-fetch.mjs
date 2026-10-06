// No live Shopify traffic is allowed in the connection tests.
globalThis.fetch = async (input, init) => {
  if (String(input) !== 'https://test-shop.myshopify.com/admin/api/2026-01/graphql.json') {
    throw new Error(`Unexpected test request: ${input}`);
  }
  if (new Headers(init.headers).get('X-Shopify-Access-Token') !== 'test-token') {
    throw new Error('Shopify token was not forwarded');
  }
  const { query, variables } = JSON.parse(init.body);
  if (!query.includes('query GetLocations') || variables.first !== 50 ||
      variables.includeInactive !== false || variables.includeLegacy !== false) {
    throw new Error('Unexpected query or missing schema defaults');
  }
  return Response.json({ data: { locations: { edges: [{ node: {
    id: 'gid://shopify/Location/1', name: 'Test warehouse', isActive: true,
  } }] } } });
};
