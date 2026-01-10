import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

// Input schema for getStoreCounts
const GetStoreCountsInputSchema = z.object({});

type GetStoreCountsInput = z.infer<typeof GetStoreCountsInputSchema>;

// Will be initialized in index.ts
let shopifyClient: GraphQLClient;

const getStoreCounts = {
  name: "get-store-counts",
  description: "Get comprehensive store counts in a single call: products (by status), variants, orders (by status), customers, and collections (by type).",
  schema: GetStoreCountsInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (_input: GetStoreCountsInput) => {
    try {
      // Single query with all count fields - uses limit: null for accurate counts
      const query = gql`
        query GetStoreCounts {
          # Product counts
          productsTotal: productsCount(limit: null) {
            count
            precision
          }
          productsActive: productsCount(limit: null, query: "status:active") {
            count
            precision
          }
          productsDraft: productsCount(limit: null, query: "status:draft") {
            count
            precision
          }
          productsArchived: productsCount(limit: null, query: "status:archived") {
            count
            precision
          }

          # Variant count (no limit arg supported)
          variantsTotal: productVariantsCount {
            count
            precision
          }

          # Order counts (limit: null supported)
          ordersTotal: ordersCount(limit: null) {
            count
            precision
          }
          ordersOpen: ordersCount(limit: null, query: "status:open") {
            count
            precision
          }
          ordersClosed: ordersCount(limit: null, query: "status:closed") {
            count
            precision
          }

          # Customer count (no limit arg supported)
          customersTotal: customersCount {
            count
            precision
          }

          # Collection counts (no limit arg supported)
          collectionsTotal: collectionsCount {
            count
            precision
          }
          collectionsSmart: collectionsCount(query: "collection_type:smart") {
            count
            precision
          }
          collectionsCustom: collectionsCount(query: "collection_type:custom") {
            count
            precision
          }
        }
      `;

      const data = (await shopifyClient.request(query)) as {
        productsTotal: { count: number; precision: string };
        productsActive: { count: number; precision: string };
        productsDraft: { count: number; precision: string };
        productsArchived: { count: number; precision: string };
        variantsTotal: { count: number; precision: string };
        ordersTotal: { count: number; precision: string };
        ordersOpen: { count: number; precision: string };
        ordersClosed: { count: number; precision: string };
        customersTotal: { count: number; precision: string };
        collectionsTotal: { count: number; precision: string };
        collectionsSmart: { count: number; precision: string };
        collectionsCustom: { count: number; precision: string };
      };

      return {
        products: {
          total: data.productsTotal.count,
          active: data.productsActive.count,
          draft: data.productsDraft.count,
          archived: data.productsArchived.count,
          precision: data.productsTotal.precision
        },
        variants: {
          total: data.variantsTotal.count,
          precision: data.variantsTotal.precision
        },
        orders: {
          total: data.ordersTotal.count,
          open: data.ordersOpen.count,
          closed: data.ordersClosed.count,
          precision: data.ordersTotal.precision
        },
        customers: {
          total: data.customersTotal.count,
          precision: data.customersTotal.precision
        },
        collections: {
          total: data.collectionsTotal.count,
          smart: data.collectionsSmart.count,
          custom: data.collectionsCustom.count,
          precision: data.collectionsTotal.precision
        }
      };
    } catch (error) {
      console.error("Error fetching store counts:", error);
      throw new Error(
        `Failed to fetch store counts: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
};

export { getStoreCounts };
