#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { google } from "googleapis";
import dotenv from "dotenv";

dotenv.config();

const { OAuth2 } = google.auth;

const GOOGLE_TASKS_API_VERSION = "v1";
const oAuth2Client = new OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URI
);

oAuth2Client.setCredentials({
  access_token: process.env.ACCESS_TOKEN,
  refresh_token: process.env.REFRESH_TOKEN,
});

const tasks = google.tasks({
  version: GOOGLE_TASKS_API_VERSION,
  auth: oAuth2Client,
});

interface CreateTaskArgs {
  title: string;
  notes?: string;
}

// Type guard for CreateTaskArgs
export function isValidCreateTaskArgs(args: any): args is CreateTaskArgs {
  return (
    typeof args === "object" &&
    args !== null &&
    "title" in args &&
    typeof args.title === "string" &&
    (args.notes === undefined || typeof args.notes === "string")
  );
}

class TasksServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: "google-tasks-server",
        version: "1.0.0",
      },
      {
        capabilities: {
          resources: {},
          tools: {},
        },
      }
    );

    this.setupHandlers();
    this.setupErrorHandling();
  }

  private setupErrorHandling(): void {
    this.server.onerror = (error) => {
      console.error("[MCP Error]", error);
    };

    process.on("SIGINT", async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupHandlers(): void {
    this.setupResourceHandlers();
    this.setupToolHandlers();
  }

  private setupResourceHandlers(): void {
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [
        {
          uri: "tasks://default",
          name: "Default Task List",
          mimeType: "application/json",
          description: "Manage your Google Tasks",
        },
      ],
    }));

    this.server.setRequestHandler(
      ReadResourceRequestSchema,
      async (request) => {
        if (request.params.uri !== "tasks://default") {
          throw new McpError(
            ErrorCode.InvalidRequest,
            `Unknown resource: ${request.params.uri}`
          );
        }

        try {
          const response = await tasks.tasks.list({
            tasklist: "@default",
          });

          return {
            contents: [
              {
                uri: request.params.uri,
                mimeType: "application/json",
                text: JSON.stringify(response.data.items, null, 2),
              },
            ],
          };
        } catch (error) {
          throw new McpError(
            ErrorCode.InternalError,
            `Tasks API error: ${error}`
          );
        }
      }
    );
  }

  private setupToolHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "create_task",
          description: "Create a new task in Google Tasks",
          inputSchema: {
            type: "object",
            properties: {
              title: { type: "string", description: "Title of the task" },
              notes: { type: "string", description: "Notes for the task" },
            },
            required: ["title"],
          },
        },
        {
          name: "list_tasks",
          description: "List all tasks in the default task list",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
      ],
    }));
    
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (request.params.name === "list_tasks") {
        try {
          const response = await tasks.tasks.list({
            tasklist: "@default",
          });
    
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(response.data.items, null, 2),
              },
            ],
          };
        } catch (error) {
          throw new McpError(
            ErrorCode.InternalError,
            `Tasks API error: ${error}`
          );
        }
      }
    
      if (request.params.name === "create_task") {
        if (!isValidCreateTaskArgs(request.params.arguments)) {
          throw new McpError(
            ErrorCode.InvalidParams,
            "Invalid arguments for creating a task. 'title' must be a string, and 'notes' must be a string or undefined."
          );
        }
    
        const args = request.params.arguments;
    
        try {
          const response = await tasks.tasks.insert({
            tasklist: "@default",
            requestBody: {
              title: args.title,
              notes: args.notes,
            },
          });
    
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(response.data, null, 2),
              },
            ],
          };
        } catch (error) {
          throw new McpError(
            ErrorCode.InternalError,
            `Tasks API error: ${error}`
          );
        }
      }
    
      throw new McpError(
        ErrorCode.MethodNotFound,
        `Unknown tool: ${request.params.name}`
      );
    });

  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Google Tasks MCP server running on stdio");
  }
}

const server = new TasksServer();
server.run().catch(console.error);