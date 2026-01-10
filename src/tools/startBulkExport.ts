import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

// Input schema for startBulkExport
const StartBulkExportInputSchema = z.object({
  type: z.enum(["products", "orders", "customers", "inventory", "custom"]).describe("Type of export to run"),
  query: z.string().optional().describe("Filter query (e.g., 'status:active' for products)"),
  dateFrom: z.string().optional().describe("Start date for orders (ISO 8601)"),
  dateTo: z.string().optional().describe("End date for orders (ISO 8601)"),
  customQuery: z.string().optional().describe("Custom GraphQL query (required if type='custom')"),
  includeMetafields: z.boolean().default(false).describe("Include metafields in export")
});

type StartBulkExportInput = z.infer<typeof StartBulkExportInputSchema>;

// Will be initialized in index.ts
let shopifyClient: GraphQLClient;

// Preset query templates
function buildProductsQuery(filter?: string, includeMetafields?: boolean): string {
  const metafieldsFragment = includeMetafields
    ? `metafields(first: 20) { edges { node { namespace key value type }}}`
    : "";

  const queryArg = filter ? `(query: "${filter}")` : "";

  return `{
    products${queryArg} {
      edges {
        node {
          id
          title
          handle
          status
          vendor
          productType
          tags
          createdAt
          updatedAt
          variants {
            edges {
              node {
                id
                title
                sku
                price
                compareAtPrice
                inventoryQuantity
                barcode
              }
            }
          }
          images {
            edges {
              node {
                url
                altText
              }
            }
          }
          ${metafieldsFragment}
        }
      }
    }
  }`;
}

function buildOrdersQuery(dateFrom?: string, dateTo?: string, filter?: string): string {
  const conditions: string[] = [];
  if (dateFrom) conditions.push(`created_at:>=${dateFrom}`);
  if (dateTo) conditions.push(`created_at:<=${dateTo}`);
  if (filter) conditions.push(filter);

  const queryArg = conditions.length > 0 ? `(query: "${conditions.join(" AND ")}")` : "";

  return `{
    orders${queryArg} {
      edges {
        node {
          id
          name
          createdAt
          updatedAt
          displayFinancialStatus
          displayFulfillmentStatus
          totalPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          customer {
            id
            email
            firstName
            lastName
          }
          shippingAddress {
            address1
            city
            province
            country
            zip
          }
          lineItems {
            edges {
              node {
                title
                quantity
                sku
                originalUnitPriceSet {
                  shopMoney {
                    amount
                  }
                }
              }
            }
          }
        }
      }
    }
  }`;
}

function buildCustomersQuery(filter?: string): string {
  const queryArg = filter ? `(query: "${filter}")` : "";

  return `{
    customers${queryArg} {
      edges {
        node {
          id
          email
          firstName
          lastName
          phone
          createdAt
          updatedAt
          ordersCount
          totalSpentV2 {
            amount
            currencyCode
          }
          defaultAddress {
            address1
            city
            province
            country
            zip
          }
          tags
        }
      }
    }
  }`;
}

function buildInventoryQuery(): string {
  return `{
    inventoryItems {
      edges {
        node {
          id
          sku
          tracked
          inventoryLevels {
            edges {
              node {
                id
                available
                location {
                  id
                  name
                }
              }
            }
          }
          variant {
            id
            title
            product {
              id
              title
            }
          }
        }
      }
    }
  }`;
}

const startBulkExport = {
  name: "start-bulk-export",
  description: "Start an async bulk export operation. Returns immediately with operation ID. Use get-bulk-operation-status to check progress.",
  schema: StartBulkExportInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: StartBulkExportInput) => {
    try {
      // Build the query based on type
      let bulkQuery: string;

      switch (input.type) {
        case "products":
          bulkQuery = buildProductsQuery(input.query, input.includeMetafields);
          break;
        case "orders":
          bulkQuery = buildOrdersQuery(input.dateFrom, input.dateTo, input.query);
          break;
        case "customers":
          bulkQuery = buildCustomersQuery(input.query);
          break;
        case "inventory":
          bulkQuery = buildInventoryQuery();
          break;
        case "custom":
          if (!input.customQuery) {
            throw new Error("customQuery is required when type is 'custom'");
          }
          bulkQuery = input.customQuery;
          break;
        default:
          throw new Error(`Unknown export type: ${input.type}`);
      }

      // Run the bulk operation
      const mutation = gql`
        mutation BulkOperationRunQuery($query: String!) {
          bulkOperationRunQuery(query: $query) {
            bulkOperation {
              id
              status
              createdAt
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      const data = (await shopifyClient.request(mutation, { query: bulkQuery })) as {
        bulkOperationRunQuery: {
          bulkOperation: {
            id: string;
            status: string;
            createdAt: string;
          } | null;
          userErrors: Array<{
            field: string[];
            message: string;
          }>;
        };
      };

      if (data.bulkOperationRunQuery.userErrors.length > 0) {
        throw new Error(
          `Failed to start bulk export: ${data.bulkOperationRunQuery.userErrors
            .map((e) => e.message)
            .join(", ")}`
        );
      }

      const operation = data.bulkOperationRunQuery.bulkOperation;

      if (!operation) {
        throw new Error("Bulk operation was not created");
      }

      return {
        success: true,
        operationId: operation.id,
        status: operation.status,
        createdAt: operation.createdAt,
        exportType: input.type,
        message: `Bulk export started. Use get-bulk-operation-status to check progress, then get-bulk-operation-results when complete.`
      };
    } catch (error) {
      console.error("Error starting bulk export:", error);
      throw new Error(
        `Failed to start bulk export: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
};

export { startBulkExport };
