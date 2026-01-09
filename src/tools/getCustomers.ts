import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

// Input schema for getCustomers
const GetCustomersInputSchema = z.object({
  searchQuery: z.string().optional(),
  limit: z.number().default(10),
  cursor: z.string().optional().describe("Pagination cursor for fetching next page")
});

type GetCustomersInput = z.infer<typeof GetCustomersInputSchema>;

// Will be initialized in index.ts
let shopifyClient: GraphQLClient;

const getCustomers = {
  name: "get-customers",
  description: "Get customers or search by name/email",
  schema: GetCustomersInputSchema,

  // Add initialize method to set up the GraphQL client
  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: GetCustomersInput) => {
    try {
      const { searchQuery, limit } = input;

      const query = gql`
        query GetCustomers($first: Int!, $query: String, $cursor: String) {
          customers(first: $first, query: $query, after: $cursor) {
            pageInfo {
              hasNextPage
              endCursor
            }
            edges {
              node {
                id
                firstName
                lastName
                email
                phone
                createdAt
                updatedAt
                tags
                defaultAddress {
                  address1
                  address2
                  city
                  provinceCode
                  zip
                  country
                  phone
                }
                addresses {
                  address1
                  address2
                  city
                  provinceCode
                  zip
                  country
                  phone
                }
                amountSpent {
                  amount
                  currencyCode
                }
                numberOfOrders
              }
            }
          }
        }
      `;

      const variables = {
        first: limit,
        query: searchQuery,
        cursor: input.cursor
      };

      const data = (await shopifyClient.request(query, variables)) as {
        customers: any;
      };

      // Extract and format customer data
      const customers = data.customers.edges.map((edge: any) => {
        const customer = edge.node;

        return {
          id: customer.id,
          firstName: customer.firstName,
          lastName: customer.lastName,
          email: customer.email,
          phone: customer.phone,
          createdAt: customer.createdAt,
          updatedAt: customer.updatedAt,
          tags: customer.tags,
          defaultAddress: customer.defaultAddress,
          addresses: customer.addresses,
          amountSpent: customer.amountSpent,
          numberOfOrders: customer.numberOfOrders
        };
      });

      return {
        customers,
        pageInfo: {
          hasNextPage: data.customers.pageInfo.hasNextPage,
          endCursor: data.customers.pageInfo.endCursor
        }
      };
    } catch (error) {
      console.error("Error fetching customers:", error);
      throw new Error(
        `Failed to fetch customers: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
};

export { getCustomers };
