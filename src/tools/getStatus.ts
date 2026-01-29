import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

const GetStatusInputSchema = z.object({});

let shopifyClient: GraphQLClient;

const getStatus = {
  name: "get-status",
  description: "Get MCP connection status, store info, server mode, and granted scopes. Use this to verify the connection is working and see what store is connected.",
  schema: GetStatusInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async () => {
    const startTime = Date.now();

    try {
      const query = gql`
        query GetShopStatus {
          shop {
            name
            url
            myshopifyDomain
            primaryDomain {
              url
              host
            }
            plan {
              displayName
              partnerDevelopment
              shopifyPlus
            }
            currencyCode
            timezoneAbbreviation
          }
          app {
            installation {
              accessScopes {
                handle
              }
            }
          }
        }
      `;

      const data = (await shopifyClient.request(query)) as {
        shop: {
          name: string;
          url: string;
          myshopifyDomain: string;
          primaryDomain: {
            url: string;
            host: string;
          };
          plan: {
            displayName: string;
            partnerDevelopment: boolean;
            shopifyPlus: boolean;
          };
          currencyCode: string;
          timezoneAbbreviation: string;
        };
        app: {
          installation: {
            accessScopes: Array<{ handle: string }>;
          };
        } | null;
      };

      const responseTime = Date.now() - startTime;
      const scopes = data.app?.installation?.accessScopes?.map(s => s.handle) || [];

      return {
        connected: true,
        responseTimeMs: responseTime,
        store: {
          name: data.shop.name,
          myshopifyDomain: data.shop.myshopifyDomain,
          primaryDomain: data.shop.primaryDomain.host,
          url: data.shop.url,
          plan: data.shop.plan.displayName,
          isPartnerDev: data.shop.plan.partnerDevelopment,
          isShopifyPlus: data.shop.plan.shopifyPlus,
          currency: data.shop.currencyCode,
          timezone: data.shop.timezoneAbbreviation
        },
        server: {
          mode: process.env.REMOTE_MCP === "true" ? "remote" : "local",
          apiVersion: "2023-07",
          configuredDomain: process.env.MYSHOPIFY_DOMAIN || "not set"
        },
        scopes: {
          granted: scopes,
          count: scopes.length
        }
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      return {
        connected: false,
        responseTimeMs: responseTime,
        error: error instanceof Error ? error.message : String(error),
        server: {
          mode: process.env.REMOTE_MCP === "true" ? "remote" : "local",
          apiVersion: "2023-07",
          configuredDomain: process.env.MYSHOPIFY_DOMAIN || "not set"
        }
      };
    }
  }
};

export { getStatus };
