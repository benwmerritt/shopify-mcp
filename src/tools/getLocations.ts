import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

// Input schema for getLocations
const GetLocationsInputSchema = z.object({
  includeInactive: z.boolean().default(false).describe("Include inactive locations"),
  includeLegacy: z.boolean().default(false).describe("Include legacy locations"),
  limit: z.number().default(50).describe("Maximum number of locations to return")
});

type GetLocationsInput = z.infer<typeof GetLocationsInputSchema>;

// Will be initialized in index.ts
let shopifyClient: GraphQLClient;

const getLocations = {
  name: "get-locations",
  description: "Get all store locations. Use this to find location IDs needed for inventory operations.",
  schema: GetLocationsInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: GetLocationsInput) => {
    try {
      const query = gql`
        query GetLocations($first: Int!, $includeInactive: Boolean!, $includeLegacy: Boolean!) {
          locations(first: $first, includeInactive: $includeInactive, includeLegacy: $includeLegacy) {
            edges {
              node {
                id
                name
                isActive
                fulfillsOnlineOrders
                hasActiveInventory
                shipsInventory
                address {
                  address1
                  address2
                  city
                  province
                  provinceCode
                  country
                  countryCode
                  zip
                  phone
                }
                fulfillmentService {
                  id
                  serviceName
                }
              }
            }
          }
        }
      `;

      const data = (await shopifyClient.request(query, {
        first: input.limit,
        includeInactive: input.includeInactive,
        includeLegacy: input.includeLegacy
      })) as {
        locations: {
          edges: Array<{
            node: {
              id: string;
              name: string;
              isActive: boolean;
              fulfillsOnlineOrders: boolean;
              hasActiveInventory: boolean;
              shipsInventory: boolean;
              address: {
                address1: string | null;
                address2: string | null;
                city: string | null;
                province: string | null;
                provinceCode: string | null;
                country: string | null;
                countryCode: string | null;
                zip: string | null;
                phone: string | null;
              };
              fulfillmentService: {
                id: string;
                serviceName: string;
              } | null;
            };
          }>;
        };
      };

      const locations = data.locations.edges.map((edge) => ({
        id: edge.node.id,
        name: edge.node.name,
        isActive: edge.node.isActive,
        fulfillsOnlineOrders: edge.node.fulfillsOnlineOrders,
        hasActiveInventory: edge.node.hasActiveInventory,
        shipsInventory: edge.node.shipsInventory,
        address: edge.node.address,
        fulfillmentService: edge.node.fulfillmentService
      }));

      return {
        locations,
        count: locations.length
      };
    } catch (error) {
      console.error("Error fetching locations:", error);
      throw new Error(
        `Failed to fetch locations: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
};

export { getLocations };
