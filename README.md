# Query your database with GPT

A CLI tool that will let you ask GPT questions about any Postgres database. Just provide your connection details, and ask-your-database automatically loads up the schema, example data, and runs queries for you.

> Note: This will directly run queries provided by GPT on the database that you provide. Unless it's a read-only connection, that means it might delete or update data by accident. Please use with caution and always keep backups of your data.

## Usage

First, create a JSON configuration file:

```json
{
  "openAIAPIKey": "xxx",
  "openAIModel": "xxx",
  "dbTimeoutMs": 20000,
  "apiTimeoutMs": 30000,
  "postgresConnection": {
    "host": "localhost",
    "port": 5432,
    "database": "imdb",
    "user": "imdb",
    "password": "1234"
  }
}
```

Then, call this with the config file like so:

```sh
TODO
```

## What it does

TODO

## Demo

## Approach

## Local development

Using pnpm or your Node package manager of choice:

```sh
pnpm install
pnpm start yourConfig.json
```
