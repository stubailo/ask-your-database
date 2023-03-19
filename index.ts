// Helpful links
// * OpenAI node SDK: https://github.com/openai/openai-node
// * Models overview: https://platform.openai.com/docs/models/overview

import {
  ChatCompletionRequestMessage,
  Configuration,
  CreateChatCompletionResponse,
  OpenAIApi,
} from "openai";
import knex from "knex";
import { knexSnakeCaseMappers } from "objection";
import { groupBy } from "lodash";
import inquirer from "inquirer";
import { AxiosResponse } from "axios";
import { z } from "zod";
import fs from "fs";

// Schema for above
const ConfigSchema = z.object({
  openAIAPIKey: z.string(),
  openAIModel: z.string(),
  postgresConnection: z.object({
    host: z.string(),
    port: z.number(),
    database: z.string(),
    user: z.string(),
    password: z.string(),
  }),
});

async function main() {
  // Accept an argument with a path to a config file. It will be the
  // last argument
  const configPath = process.argv[process.argv.length - 1];

  if (!configPath) {
    console.log("Please provide a path to a config file");
    process.exit(1);
  }

  const config = ConfigSchema.parse(
    JSON.parse(fs.readFileSync(configPath, "utf-8"))
  );

  const db = await createDb(config);

  // First, print out the schema in a convenient format
  const schema = await db.raw(`
    SELECT
      table_name,
      column_name,
      data_type,
      is_nullable,
      column_default
    FROM
      information_schema.columns
    WHERE
      table_schema = 'public'
    ORDER BY
      table_name,
      ordinal_position;
  `);

  // Group by table_name
  const tables = groupBy(schema.rows, "table_name");

  // For each table name, run a query to get an example row

  // This will be an object that maps the table name to the example row
  const exampleRows: Record<string, any> = {};
  for (const tableName of Object.keys(tables)) {
    const exampleRow = await db(tableName).first();
    exampleRows[tableName] = exampleRow;
  }

  // Make a nice string for each table
  const tableStrings = Object.entries(tables).map(([tableName, columns]) => {
    const columnStrings = columns.map(
      (column) =>
        `  ${column.column_name} ${column.data_type} ${
          column.is_nullable === "YES" ? "NULL" : "NOT NULL"
        }; Example: ${exampleRows[tableName][column.column_name]}`
    );
    return `CREATE TABLE ${tableName} (
${columnStrings.join(",\n")}
);`;
  });

  // Print out the schema
  const schemaString = tableStrings.join("\n\n");

  const configuration = new Configuration({
    apiKey: config.openAIAPIKey,
  });
  const openai = new OpenAIApi(configuration);

  // Print out some introductory info like the name of the database and the names of the tables in the schema.
  console.log(`You are connected to the database ${
    config.postgresConnection.database
  }. It has the following tables:

${Object.keys(tables).join(", ")}
`);

  const { initialQuestion } = await inquirer.prompt({
    type: "input",
    name: "initialQuestion",
    message:
      "Ask me a question about this database, and I'll try to answer! (q to quit)",
  });

  if (initialQuestion === "q") {
    process.exit(0);
  }

  let messages: ChatCompletionRequestMessage[] = [
    {
      role: "system",
      content: `You are a helpful assistant that writes SQL queries in order to answer questions about a database.`,
    },
    {
      role: "user",
      content: `Hello, I have a database with the following schema:

${schemaString}

I'd like to work with you to answer a question I have. I can run several queries to get the answer, and tell you the results along the way.
I'd like to use the fewest queries possible, so use joins where you can. If you're not sure what to do, you can ask me questions about the database
or run intermediate queries learn more about the data, but I can only run one query at a time.

The question I have is:

"${initialQuestion}"`,
    },
  ];

  while (true) {
    console.log("Calling GPT...");
    const startTime = Date.now();

    let response: AxiosResponse<CreateChatCompletionResponse, any> | undefined;

    // Call the API. If there is an error, try up to 3 times.
    let numTries = 0;
    while (numTries < 3) {
      try {
        response = (await openai.createChatCompletion(
          {
            model: config.openAIModel,
            messages: messages,
          },
          {
            timeout: 20000,
          }
        )) as AxiosResponse<CreateChatCompletionResponse, any>;
      } catch (error: any) {
        console.log("ERROR", error.message);
        numTries++;
        if (numTries < 3) {
          console.log("Retrying...");
        } else {
          console.log("Giving up.");
          process.exit(1);
        }

        continue;
      }

      break;
    }

    const endTime = Date.now();
    console.log(
      `Took ${endTime - startTime} ms. Used ${
        response!.data.usage!.total_tokens
      } tokens so far.`
    );

    const responseContent = response!.data!.choices[0]!.message!.content;

    console.log(`

ASSISTANT:
    
${responseContent}
`);

    messages.push({
      role: "assistant",
      content: response!.data!.choices[0]!.message!.content,
    });

    const queries = extractQueriesFromResponse(responseContent);

    let resultString = "";
    // Run all of the queries and print the first few rows of each in a nice table
    for (const query of queries) {
      try {
        const result = await db.raw(query).timeout(10000);

        // Get the first 100 values
        const rows: Record<string, any>[] = [];

        let numValues = 0;
        for (const row of result.rows) {
          rows.push(row);

          numValues += Object.values(row).length;

          if (numValues > 100) {
            break;
          }
        }

        console.log(
          `Returned ${result.rows.length} rows. Here are the first ${rows.length} rows:`
        );
        console.table(rows);

        resultString += `

        
I ran \`${query}\` and it returned ${
          result.rows.length
        } rows. Here are the first few rows:

${JSON.stringify(rows, null, 2)}

`;
      } catch (e: any) {
        console.table({ error: `Error: ${e.message}` });
        resultString += `
Result for \`${query}\` was an error: ${e.message}
`;
      }
    }

    const { nextMessage } = await inquirer.prompt({
      type: "input",
      name: "nextMessage",
      message:
        "How would you like to respond? Any query results will be automatically sent with your response. (q to quit)",
    });

    if (nextMessage === "q") {
      break;
    }

    const messageWithResult = `

    ${nextMessage}

    ${resultString}
`;

    messages.push({
      role: "user",
      content: messageWithResult,
    });
  }

  await db.destroy();
}

main();

async function createDb(config: z.infer<typeof ConfigSchema>) {
  const db = knex({
    client: "pg",
    connection: {
      user: config.postgresConnection.user,
      host: config.postgresConnection.host,
      database: config.postgresConnection.database,
      password: config.postgresConnection.password,
      port: config.postgresConnection.port,
    },
    pool: {
      min: 1,
      max: 32,
    },
    ...knexSnakeCaseMappers(),
  });

  await db.raw("SELECT now()");

  return db;
}

function extractQueriesFromResponse(responseContent: string) {
  const chunks = responseContent.split("```");

  // Get every even numbered chunk
  const queries = chunks.filter((_, i) => (i - 1) % 2 === 0);

  // Remove a leading `sql` from each chunk
  const cleanedQueries = queries
    .map((query) => query.replace(/^sql/, ""))
    .map((query) => query.trim());

  return cleanedQueries;
}
