// Helpful links
// * OpenAI node SDK: https://github.com/openai/openai-node
// * Models overview: https://platform.openai.com/docs/models/overview

import * as dotenv from "dotenv"; // see https://github.com/motdotla/dotenv#how-do-i-use-dotenv-with-import
dotenv.config();

import { ChatCompletionRequestMessage, Configuration, OpenAIApi } from "openai";
import knex from "knex";
import { knexSnakeCaseMappers } from "objection";
import { groupBy } from "lodash";
import inquirer from "inquirer";

async function main() {
  const db = await createDb();

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

  // Make a nice string for each table
  const tableStrings = Object.entries(tables).map(([tableName, columns]) => {
    const columnStrings = columns.map(
      (column) =>
        `  ${column.column_name} ${column.data_type} ${
          column.is_nullable === "YES" ? "NULL" : "NOT NULL"
        }`
    );
    return `CREATE TABLE ${tableName} (
${columnStrings.join(",\n")}
);`;
  });

  // Print out the schema
  const schemaString = tableStrings.join("\n\n");

  const configuration = new Configuration({
    apiKey: process.env.OPENAI_KEY,
  });
  const openai = new OpenAIApi(configuration);

  console.log(
    `SYSTEM: You are a helpful assistant that writes SQL queries in order to answer questions about a database.
`
  );
  console.log(`USER:

I'd like to work with you to answer a question I have. I can
run several queries to get the answer, and tell you the results along the way.
The question I have is:`);

  const { initialQuestion } = await inquirer.prompt({
    type: "input",
    name: "initialQuestion",
    message: "What is the initial question?",
  });

  console.log(`USER: ${initialQuestion}
  
What is the first query I should run, and why? I'd like to use the fewest queries possible, so use
joins where you can.`);

  let messages: ChatCompletionRequestMessage[] = [
    {
      role: "system",
      content: `You are a helpful assistant that writes SQL queries in order to answer questions about a database.`,
    },
    {
      role: "user",
      content: `Hello, I have a database with the following schema:

${schemaString}

I'd like to work with you to answer a question I have. I can
run several queries to get the answer, and tell you the results along the way.
The question I have is:

"${initialQuestion}"

What is the first query I should run, and why? I'd like to use the fewest queries possible, so use
joins where you can.`,
    },
  ];

  while (true) {
    console.log("Calling GPT...");
    console.time("completion");
    let response;
    try {
      response = await openai.createChatCompletion({
        model: "gpt-4",
        messages: messages,
      });
    } catch (e: any) {
      console.log(e.message);
      break;
    }
    console.timeEnd("completion");

    console.log(response.data.usage);

    const responseContent = response!.data!.choices[0]!.message!.content;

    console.log(`ASSISTANT:
    
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
      const result = await db.raw(query);

      console.log(`────────────────────────────────
The following result will be appended to your next message:
${query}`);
      console.table(result.rows.slice(0, 5));

      resultString += `
Result for \`${query}\`:

${JSON.stringify(result.rows.slice(0, 5), null, 2)}

`;
    }

    const { nextMessage } = await inquirer.prompt({
      type: "input",
      name: "nextMessage",
      message: "How would you like to respond? (q to quit)",
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

async function createDb() {
  let dbConfig = {
    user: "imdb",
    host: "localhost",
    database: "imdb",
    password: "1234",
    port: 5432,
  };

  const db = knex({
    client: "pg",
    connection: dbConfig,
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
