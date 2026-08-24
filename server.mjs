import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema
} from "@modelcontextprotocol/sdk/types.js";

import fs from "fs/promises";
import path from "path";

const ROOT = "F:\\MCP-CLEAN";
const CONFIG = path.join(ROOT, "config", "allowed-roots.json");
const BACKUPS = path.join(ROOT, "backups");
const LOGS = path.join(ROOT, "logs");

const config = JSON.parse(
  await fs.readFile(CONFIG, "utf8")
);

const allowedRoots = config.readWrite.map(p =>
  path.resolve(p)
);

function isAllowed(target) {
  const full = path.resolve(target);

  return allowedRoots.some(root =>
    full.startsWith(root)
  );
}

async function log(message) {
  const file = path.join(
    LOGS,
    "mcp-clean.log"
  );

  await fs.appendFile(
    file,
    `${new Date().toISOString()} ${message}\n`
  );
}

const server = new Server(
  {
    name: "mcp-clean",
    version: "1.1.0"
  },
  {
    capabilities: {
      tools: {}
    }
  }
);


server.setRequestHandler(
  ListToolsRequestSchema,
  async () => ({
    tools: [

      {
        name: "ping",
        description: "Проверка MCP",
        inputSchema: {
          type: "object",
          properties: {}
        }
      },

      {
        name: "list_directory",
        description:
          "Список файлов в разрешенной папке",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string"
            }
          },
          required: ["path"]
        }
      },

      {
        name: "read_file",
        description:
          "Чтение файла",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string"
            }
          },
          required: ["path"]
        }
      },

      {
        name: "write_file",
        description:
          "Запись файла с резервной копией",
        inputSchema: {
          type: "object",
          properties: {
            path: {
              type: "string"
            },
            content: {
              type: "string"
            }
          },
          required: [
            "path",
            "content"
          ]
        }
      }

    ]
  })
);


server.setRequestHandler(
  CallToolRequestSchema,
  async (request) => {

    const { name } = request.params;
    const args = request.params.arguments || {};


    if (name === "ping") {
      return {
        content: [
          {
            type: "text",
            text: "MCP CLEAN READY"
          }
        ]
      };
    }


    if (name === "list_directory") {

      if (!isAllowed(args.path)) {
        throw new Error("ACCESS DENIED");
      }

      const files =
        await fs.readdir(
          args.path,
          { withFileTypes: true }
        );

      return {
        content: [
          {
            type: "text",
            text: files
              .map(f =>
                `${f.isDirectory() ? "[DIR]" : "[FILE]"} ${f.name}`
              )
              .join("\n")
          }
        ]
      };
    }


    if (name === "read_file") {

      if (!isAllowed(args.path)) {
        throw new Error("ACCESS DENIED");
      }

      const data =
        await fs.readFile(
          args.path,
          "utf8"
        );

      return {
        content: [
          {
            type: "text",
            text: data
          }
        ]
      };
    }


    if (name === "write_file") {

      if (!isAllowed(args.path)) {
        throw new Error("ACCESS DENIED");
      }


      try {
        const old =
          await fs.readFile(
            args.path,
            "utf8"
          );

        const backup =
          path.join(
            BACKUPS,
            path.basename(args.path)
            + ".bak"
          );

        await fs.writeFile(
          backup,
          old,
          "utf8"
        );

      } catch {}

      await fs.writeFile(
        args.path,
        args.content,
        "utf8"
      );


      await log(
        `WRITE ${args.path}`
      );


      return {
        content: [
          {
            type: "text",
            text: "WRITE OK"
          }
        ]
      };
    }


    throw new Error(
      "Unknown tool"
    );

  }
);


const transport =
  new StdioServerTransport();


await server.connect(
  transport
);

console.error(
  "MCP CLEAN READY"
);